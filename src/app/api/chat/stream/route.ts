import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { streamAppWithOpenRouter } from "@/lib/engine/code-providers";
import {
  buildMasterPrompt,
  buildStagePrompt,
  stagedStages,
} from "@/lib/engine/staged-generation";
import { isOwner, resolvePlan } from "@/lib/access";
import { authorizeProjectOwner, consumeRateLimit, isUuid } from "@/lib/engine/data-guard";
import { finalizeGeneration, reserveGeneration } from "@/lib/engine/generation-usage";
import { sanitizePromptAttachments } from "@/lib/engine/prompt-attachments";
import { classifyGenerationFailure, safeOperationalMessage } from "@/lib/engine/observability";
import type { AppFile } from "@/lib/engine/app-types";

/**
 * Construção POR ETAPAS com streaming SSE (Fase 1 — paridade Lovable).
 *
 * POST { projectId, prompt } (+ currentFiles/currentCode/name/userKey/
 * userProvider/costMode/attachments opcionais).
 *
 * Consome staged-generation.ts (as MESMAS etapas do cliente e do worker) e o
 * motor de streaming de code-providers.ts. Emite um evento por etapa:
 *   stage        → {"index":1,"total":7,"label":"..."}     início da etapa
 *   model        → {"model":"...","attempt":1}             tentativa do chain
 *   token        → {"t":"..."}                              delta de texto
 *   stage-result → AppGenerationResult da etapa (arquivos acumulados)
 *   error        → {"error":"...","stage":N,"fallbackCard":true?}
 *   done         → {"stages":N}
 *
 * A rota exige uma chave OpenRouter (do usuário ou do ambiente) — o streaming
 * por etapas não degrada silenciosamente para outro transporte. Cada etapa
 * reserva/contabiliza uma geração, como no fluxo do painel.
 */
export const maxDuration = 300;

const encoder = new TextEncoder();

function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const owner = isOwner({ role: profile?.role, email: user.email });

  if (!owner && !(await consumeRateLimit(`generation:${user.id}`, Number(process.env.GENERATION_RATE_LIMIT ?? 20), 60 * 60_000))) {
    return NextResponse.json({ error: "Muitas gerações em pouco tempo. Aguarde e tente de novo." }, { status: 429 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }
  const { projectId, currentCode, currentFiles, name, userKey, userProvider, costMode } = body ?? {};
  const prompt = typeof body?.prompt === "string" && body.prompt.trim()
    ? body.prompt
    : typeof body?.message === "string" ? body.message : "";
  if (!projectId || !prompt.trim()) {
    return NextResponse.json({ error: "Requisição incompleta." }, { status: 400 });
  }

  const access = await authorizeProjectOwner(supabase, projectId, user.id, owner);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status ?? 403 });
  }

  const openRouterKey =
    userProvider === "openrouter" && typeof userKey === "string" && userKey
      ? userKey
      : process.env.OPENROUTER_API_KEY || null;
  if (!openRouterKey) {
    return NextResponse.json(
      { error: "O streaming por etapas exige uma chave OpenRouter (do usuário ou do ambiente)." },
      { status: 422 }
    );
  }

  const attachments = sanitizePromptAttachments(body?.attachments);
  const { data: sub } = owner ? { data: null } : await supabase.from("subscriptions").select("plan").eq("user_id", user.id).maybeSingle();
  const plan = resolvePlan({ plan: sub?.plan, role: profile?.role, email: user.email });

  const initialFiles: AppFile[] | null = Array.isArray(currentFiles) && currentFiles.length ? currentFiles : null;
  const initialCode: string | null = typeof currentCode === "string" && currentCode.trim() ? currentCode : null;
  const kind: "initial" | "refinement" = initialFiles || initialCode ? "refinement" : "initial";
  const stages = stagedStages(kind);
  const masterPrompt = buildMasterPrompt(prompt, attachments);
  const projectName = typeof name === "string" ? name : "App";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try { controller.enqueue(sse(event, data)); } catch { /* cliente desconectou */ }
      };
      let workingFiles = initialFiles;
      let workingCode = initialCode;
      let completed = 0;
      try {
        for (let index = 0; index < stages.length; index++) {
          const stage = stages[index];
          send("stage", { index: index + 1, total: stages.length, label: stage.label });
          const stageStarted = Date.now();
          const stageMessage = buildStagePrompt(masterPrompt, stage, index, stages.length, kind);
          const stageRequestId = typeof body?.requestId === "string" && isUuid(body.requestId) && index === 0
            ? body.requestId
            : crypto.randomUUID();

          const reservation = await reserveGeneration({
            supabase, userId: user.id, projectId, prompt: stageMessage,
            limit: plan.maxGenerationsPerMonth, unlimited: owner,
            requestId: stageRequestId, kind: "app",
          });
          if (reservation.error || reservation.limitReached || reservation.inProgress || reservation.duplicateCompleted) {
            send("error", {
              error: reservation.limitReached
                ? `Limite de ${plan.maxGenerationsPerMonth} gerações do plano ${plan.name} atingido este mês.`
                : "Não foi possível reservar a geração desta etapa. As etapas anteriores foram transmitidas.",
              stage: index + 1,
            });
            break;
          }

          const diag: string[] = [];
          const args = {
            message: stageMessage,
            currentCode: workingCode,
            currentFiles: workingFiles,
            name: projectName,
            userKey: openRouterKey,
            userProvider: "openrouter" as const,
            costMode: costMode ?? "auto",
            forceReal: true,
            attachments: index === 0 ? attachments.filter((attachment) => attachment.kind === "image") : [],
          };
          const result = await streamAppWithOpenRouter(openRouterKey, args, {
            diag,
            onModel: (model, attempt) => send("model", { model, attempt, stage: index + 1 }),
            onToken: (t) => send("token", { t }),
          });

          if (result.engineMode !== "real") {
            const reason = result.failureReason;
            await finalizeGeneration(supabase, reservation.id, {
              status: "failed",
              provider: result.provider,
              durationMs: Date.now() - stageStarted,
              errorCode: classifyGenerationFailure(reason || "streaming_stage_failed"),
              errorMessage: safeOperationalMessage(reason || "Etapa não concluída no modo streaming."),
              metadata: { requestId: stageRequestId, stage: index + 1, streaming: true },
            });
            send("error", {
              error: reason
                ? `A etapa ${index + 1} falhou: ${reason}`
                : `A etapa ${index + 1} não foi concluída pela IA.`,
              stage: index + 1,
              fallbackCard: true,
            });
            break;
          }

          await finalizeGeneration(supabase, reservation.id, {
            status: "completed",
            provider: result.provider,
            cost: result.cost ?? 0,
            model: result.model ?? null,
            durationMs: Date.now() - stageStarted,
            metadata: { requestId: stageRequestId, stage: index + 1, streaming: true },
          });

          if (result.app.files?.length) {
            workingFiles = result.app.files;
            workingCode = null;
          } else if (typeof result.app.code === "string") {
            workingCode = result.app.code;
            workingFiles = null;
          }
          completed = index + 1;
          send("stage-result", { stage: index + 1, total: stages.length, ...result });
        }
        send("done", { stages: completed });
      } catch (error) {
        send("error", { error: safeOperationalMessage(error) });
        send("done", { stages: completed });
      } finally {
        try { controller.close(); } catch { /* já fechado */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
