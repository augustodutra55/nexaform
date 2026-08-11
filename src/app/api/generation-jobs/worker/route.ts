import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateAppWithProviders } from "@/lib/engine/code-providers";
import { isAppCode, isMultiFile } from "@/lib/engine/app-types";
import {
  BACKGROUND_MAX_ATTEMPTS,
  isBackgroundGenerationPayload,
  nextBackgroundJobStatus,
  retryDelaySeconds,
} from "@/lib/engine/background-jobs";
import { buildStagePrompt, buildStageRetryPrompt, stagedStages } from "@/lib/engine/staged-generation";
import { classifyGenerationFailure, safeOperationalMessage } from "@/lib/engine/observability";

export const maxDuration = 300;
const WORKER_MAX_MS = Math.min(210_000, Number(process.env.GEN_MAX_MS) || 200_000);

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function failClaimedJob(args: {
  admin: NonNullable<ReturnType<typeof createAdminClient>>;
  rowId: string;
  workerId: string;
  message: string;
  reason: string;
  reservationId?: string | null;
  userId?: string;
  requestId?: string;
}) {
  await args.admin.from("staged_generation_jobs").update({
    status: "failed",
    last_error: args.message.slice(0, 800),
    locked_at: null,
    locked_by: null,
    completed_at: new Date().toISOString(),
  }).eq("id", args.rowId).eq("locked_by", args.workerId);
  if (args.reservationId && args.userId) {
    await args.admin.from("generations").update({
      status: "failed",
      provider: "openrouter",
      error_code: args.reason,
      error_message: args.message.slice(0, 800),
      metadata: {
        requestId: args.requestId ?? null,
        background: true,
      },
    }).eq("id", args.reservationId).eq("user_id", args.userId);
  }
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Service role não configurada." }, { status: 503 });
  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json({ error: "OPENROUTER_API_KEY não configurada." }, { status: 503 });
  }

  const workerId = `vercel-${crypto.randomUUID()}`;
  const { data: claimed, error: claimError } = await admin
    .rpc("claim_staged_generation_job", { p_worker_id: workerId, p_lease_seconds: 300 });
  if (claimError) return NextResponse.json({ error: "Falha ao consultar a fila." }, { status: 503 });
  const row = Array.isArray(claimed) ? claimed[0] : null;
  if (!row) return NextResponse.json({ processed: false, reason: "empty_queue" });

  const payload = row.payload;
  if (!isBackgroundGenerationPayload(payload)) {
    await failClaimedJob({
      admin,
      rowId: row.id,
      workerId,
      message: "Payload de geração inválido.",
      reason: "invalid_payload",
    });
    return NextResponse.json({ processed: true, status: "failed", reason: "invalid_payload" });
  }

  const { data: project } = await admin
    .from("projects")
    .select("id,user_id,schema")
    .eq("id", payload.projectId)
    .eq("user_id", payload.userId)
    .maybeSingle();
  if (!project) {
    await failClaimedJob({
      admin,
      rowId: row.id,
      workerId,
      message: "Projeto não encontrado ou não pertence ao usuário da fila.",
      reason: "project_not_found",
      reservationId: payload.reservationId,
      userId: payload.userId,
      requestId: payload.requestId,
    });
    return NextResponse.json({ processed: true, status: "failed", reason: "project_not_found" });
  }

  const kind = payload.stagedJob.kind ?? "initial";
  const stages = stagedStages(kind);
  const stage = stages[payload.stageIndex];
  if (!stage) {
    await failClaimedJob({
      admin,
      rowId: row.id,
      workerId,
      message: "Etapa inexistente.",
      reason: "stage_not_found",
      reservationId: payload.reservationId,
      userId: payload.userId,
      requestId: payload.requestId,
    });
    return NextResponse.json({ processed: true, status: "failed", reason: "stage_not_found" });
  }

  const current = isAppCode(project.schema) ? project.schema : null;
  const currentFiles = current && isMultiFile(current) ? current.files : null;
  const currentCode = current && !isMultiFile(current) ? current.code ?? null : null;
  const attempts = Number(row.attempts) || 1;
  const promptBuilder = attempts > 1 ? buildStageRetryPrompt : buildStagePrompt;
  const prompt = promptBuilder(
    payload.stagedJob.masterPrompt,
    stage,
    payload.stageIndex,
    stages.length,
    kind
  );
  const started = Date.now();
  let result: Awaited<ReturnType<typeof generateAppWithProviders>>;
  try {
    const TIMEOUT = Symbol("worker-timeout");
    const raced = await Promise.race([
      generateAppWithProviders({
        message: prompt,
        currentCode,
        currentFiles,
        name: payload.name,
        userKey: process.env.OPENROUTER_API_KEY,
        userProvider: "openrouter",
        // Depois da primeira falha, priorize o modelo de código mais confiável.
        // A redução de escopo do retry limita custo e tamanho da resposta.
        costMode: attempts >= 2 ? "premium" : payload.costMode,
        forceReal: true,
        allowTemplate: false,
        attachments: [],
        mediaAssets: [],
      }),
      new Promise<typeof TIMEOUT>((resolve) => setTimeout(() => resolve(TIMEOUT), WORKER_MAX_MS)),
    ]);
    if (raced === TIMEOUT) throw new Error("A etapa excedeu o tempo seguro do worker.");
    result = raced;
    if (result.engineMode !== "real" || !result.app) {
      throw new Error(result.failureReason || "A IA não devolveu código válido.");
    }
  } catch (error) {
    const message = safeOperationalMessage(error);
    const status = nextBackgroundJobStatus({
      status: "running",
      succeeded: false,
      attempts,
      maxAttempts: BACKGROUND_MAX_ATTEMPTS,
    });
    const delay = retryDelaySeconds(attempts);
    await admin.from("staged_generation_jobs").update({
      status,
      last_error: message.slice(0, 800),
      next_attempt_at: new Date(Date.now() + delay * 1000).toISOString(),
      locked_at: null,
      locked_by: null,
      completed_at: status === "failed" ? new Date().toISOString() : null,
    }).eq("id", row.id).eq("locked_by", workerId);
    if (status === "failed" && payload.reservationId) {
      await admin.from("generations").update({
        status: "failed",
        provider: "openrouter",
        duration_ms: Date.now() - started,
        error_code: classifyGenerationFailure(message),
        error_message: message.slice(0, 800),
        metadata: { requestId: payload.requestId, background: true, attempts },
      }).eq("id", payload.reservationId).eq("user_id", payload.userId);
    }
    return NextResponse.json({ processed: true, status, attempts });
  }

  const completedPayload = { ...payload, result };
  const { error: completeError } = await admin.from("staged_generation_jobs").update({
    status: "completed",
    payload: completedPayload,
    last_error: null,
    locked_at: null,
    locked_by: null,
    completed_at: new Date().toISOString(),
  }).eq("id", row.id).eq("locked_by", workerId);
  if (completeError) {
    return NextResponse.json({ error: "A etapa terminou, mas o resultado não pôde ser salvo." }, { status: 503 });
  }
  if (payload.reservationId) {
    await admin.from("generations").update({
      status: "completed",
      provider: result.provider,
      model: result.model ?? null,
      cost_usd: Math.max(0, result.cost ?? 0),
      duration_ms: Date.now() - started,
      error_code: null,
      error_message: null,
      metadata: { requestId: payload.requestId, background: true, stage: payload.stageIndex + 1 },
    }).eq("id", payload.reservationId).eq("user_id", payload.userId);
  }
  return NextResponse.json({
    processed: true,
    status: "completed",
    projectId: payload.projectId,
    stage: payload.stageIndex + 1,
  });
}
