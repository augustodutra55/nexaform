import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  generateAppWithProviders,
  streamAppWithOpenRouter,
} from "@/lib/engine/code-providers";
import { isOwner, resolvePlan } from "@/lib/access";
import { authorizeProjectOwner, consumeRateLimit, isUuid } from "@/lib/engine/data-guard";
import { finalizeGeneration, reserveGeneration } from "@/lib/engine/generation-usage";
import { sanitizePromptAttachments } from "@/lib/engine/prompt-attachments";
import { classifyGenerationFailure, safeOperationalMessage } from "@/lib/engine/observability";

/**
 * Chat → código com streaming SSE (Fase 1 — paridade Lovable).
 *
 * POST { projectId, prompt } (aceita também os campos de /api/generate-app:
 * message, currentCode, currentFiles, name, userKey, userProvider, costMode).
 *
 * Resposta: text/event-stream com eventos
 *   model  → {"model":"...","attempt":1}   início de cada tentativa do chain
 *   token  → {"t":"..."}                    delta de texto do modelo
 *   result → AppGenerationResult + projectCost
 *   error  → {"error":"...","fallbackCard":true?}
 *   done   → {}
 *
 * Consome o MESMO motor (code-providers.ts) e o MESMO chain de fallback do
 * caminho síncrono. Sem chave OpenRouter disponível, degrada para a geração
 * síncrona (Anthropic direta) e emite apenas result/done — o protocolo do
 * cliente permanece idêntico. O pipeline de imagens (ADIMG) ainda não roda
 * nesta rota; refinamentos raramente introduzem marcadores novos.
 */
export const maxDuration = 300;

const encoder = new TextEncoder();

function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: NextRequest) {
  const started = Date.now();
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
  const message = typeof body?.prompt === "string" && body.prompt.trim()
    ? body.prompt
    : typeof body?.message === "string" ? body.message : "";
  if (!projectId || !message.trim()) {
    return NextResponse.json({ error: "Requisição incompleta." }, { status: 400 });
  }

  const access = await authorizeProjectOwner(supabase, projectId, user.id, owner);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status ?? 403 });
  }

  const attachments = sanitizePromptAttachments(body?.attachments);
  const requestId = typeof body?.requestId === "string" && isUuid(body.requestId)
    ? body.requestId
    : crypto.randomUUID();

  const { data: sub } = owner ? { data: null } : await supabase.from("subscriptions").select("plan").eq("user_id", user.id).maybeSingle();
  const plan = resolvePlan({ plan: sub?.plan, role: profile?.role, email: user.email });
  const reservation = await reserveGeneration({
    supabase, userId: user.id, projectId, prompt: message,
    limit: plan.maxGenerationsPerMonth, unlimited: owner,
    requestId, kind: "app",
  });
  if (reservation.error) {
    return NextResponse.json(
      { error: "Não foi possível reservar sua geração. Tente novamente.", errorCode: "generation_reservation_failed" },
      { status: 503 }
    );
  }
  if (reservation.limitReached) return NextResponse.json(
    { error: `Limite de ${plan.maxGenerationsPerMonth} gerações do plano ${plan.name} atingido este mês.`, limitReached: true },
    { status: 402 }
  );
  if (reservation.inProgress || reservation.duplicateCompleted) {
    return NextResponse.json({
      error: reservation.inProgress
        ? "Este mesmo pedido já está sendo processado. Aguarde a conclusão."
        : "Este pedido já foi concluído e não será cobrado novamente. Atualize o projeto.",
      requestId,
      inProgress: !!reservation.inProgress,
      duplicateCompleted: !!reservation.duplicateCompleted,
    }, { status: 409 });
  }

  const args = {
    message,
    currentCode: typeof currentCode === "string" ? currentCode : null,
    currentFiles: Array.isArray(currentFiles) ? currentFiles : null,
    name: typeof name === "string" ? name : "App",
    userKey: typeof userKey === "string" ? userKey : null,
    userProvider: (userProvider ?? null) as "claude" | "openrouter" | "local" | null,
    costMode: costMode ?? "auto",
    forceReal: true,
    attachments,
  };

  // Streaming exige OpenRouter. A rota só assume o transporte SSE com tokens
  // quando o provedor efetivo seria OpenRouter também no caminho síncrono;
  // caso contrário (chave Anthropic), degrada para a geração síncrona.
  const openRouterKey =
    args.userProvider === "openrouter" && args.userKey
      ? args.userKey
      : !args.userKey && !process.env.ANTHROPIC_API_KEY && process.env.OPENROUTER_API_KEY
        ? process.env.OPENROUTER_API_KEY
        : null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try { controller.enqueue(sse(event, data)); } catch { /* cliente desconectou */ }
      };
      const diag: string[] = [];
      try {
        const result = openRouterKey
          ? await streamAppWithOpenRouter(openRouterKey, args, {
              diag,
              onModel: (model, attempt) => send("model", { model, attempt }),
              onToken: (t) => send("token", { t }),
            })
          : await generateAppWithProviders(args);

        if (result.engineMode !== "real") {
          const reason = result.failureReason;
          const error = reason
            ? `A geração real falhou: ${reason} — não vou te entregar um demo disfarçado. Verifique sua chave/modelo em Configurações.`
            : "Modo de geração real ativo, mas nenhuma IA está conectada. Conecte uma chave de IA em Configurações.";
          await finalizeGeneration(supabase, reservation.id, {
            status: "failed",
            provider: result.provider,
            durationMs: Date.now() - started,
            errorCode: classifyGenerationFailure(reason || error),
            errorMessage: safeOperationalMessage(reason || error),
            metadata: { requestId, attempt: reservation.attempt ?? 1, streaming: !!openRouterKey },
          });
          send("error", { error, fallbackCard: true, needsKey: !reason });
          send("done", {});
          controller.close();
          return;
        }

        await finalizeGeneration(supabase, reservation.id, {
          status: "completed",
          provider: result.provider,
          cost: result.cost ?? 0,
          model: result.model ?? null,
          durationMs: Date.now() - started,
          metadata: { requestId, attempt: reservation.attempt ?? 1, streaming: !!openRouterKey },
        });

        const { data: rows } = await supabase.from("generations").select("cost_usd").eq("project_id", projectId);
        const projectCost = (rows ?? []).reduce((s: number, r: any) => s + Number(r.cost_usd ?? 0), 0);
        send("result", { ...result, projectCost });
        send("done", {});
      } catch (error) {
        const messageText = safeOperationalMessage(error);
        await finalizeGeneration(supabase, reservation.id, {
          status: "failed",
          durationMs: Date.now() - started,
          errorCode: classifyGenerationFailure(messageText),
          errorMessage: messageText,
          metadata: { requestId, attempt: reservation.attempt ?? 1, streaming: !!openRouterKey },
        });
        send("error", { error: "A geração falhou antes de concluir. Tente novamente." });
        send("done", {});
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
