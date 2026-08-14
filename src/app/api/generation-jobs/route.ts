import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isOwner, resolvePlan } from "@/lib/access";
import { authorizeProjectOwner, isUuid } from "@/lib/engine/data-guard";
import { reserveGeneration, finalizeGeneration } from "@/lib/engine/generation-usage";
import { isAppCode, type AppCode } from "@/lib/engine/app-types";
import {
  BACKGROUND_GENERATION_VERSION,
  type BackgroundGenerationPayload,
} from "@/lib/engine/background-jobs";
import {
  buildStagePrompt,
  isValidStagedBuildJob,
  stagedJobForCloud,
  stagedStages,
  type StagedBuildJob,
} from "@/lib/engine/staged-generation";

export const maxDuration = 30;

async function context() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, owner: false, plan: null };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const owner = isOwner({ role: profile?.role, email: user.email });
  const { data: subscription } = owner
    ? { data: null }
    : await supabase.from("subscriptions").select("plan").eq("user_id", user.id).maybeSingle();
  return {
    supabase,
    user,
    owner,
    plan: resolvePlan({ plan: subscription?.plan, role: profile?.role, email: user.email }),
  };
}

export async function GET(req: NextRequest) {
  const { supabase, user } = await context();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId || !isUuid(projectId)) {
    return NextResponse.json({ error: "Projeto inválido." }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("staged_generation_jobs")
    .select("id,status,payload,attempts,next_attempt_at,last_error,updated_at,completed_at")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Não foi possível consultar a fila." }, { status: 503 });
  return NextResponse.json({ job: data ?? null });
}

export async function POST(req: NextRequest) {
  const { supabase, user, owner, plan } = await context();
  if (!user || !plan) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  let body: {
    projectId?: string;
    threadId?: string;
    job?: StagedBuildJob;
    name?: string;
    costMode?: string;
    currentApp?: AppCode;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }
  if (!body.projectId || !body.threadId || !isUuid(body.projectId) || !isUuid(body.threadId)) {
    return NextResponse.json({ error: "Projeto ou conversa inválidos." }, { status: 400 });
  }
  if (!isValidStagedBuildJob(body.job, body.projectId, body.threadId)) {
    return NextResponse.json({ error: "A etapa enviada não é válida." }, { status: 400 });
  }
  if (body.currentApp !== undefined && !isAppCode(body.currentApp)) {
    return NextResponse.json({ error: "O snapshot de retomada não é válido." }, { status: 400 });
  }
  const access = await authorizeProjectOwner(supabase, body.projectId, user.id, owner);
  if (!access.allowed) return NextResponse.json({ error: access.error }, { status: access.status ?? 403 });
  const { data: thread } = await supabase
    .from("chat_threads")
    .select("id")
    .eq("id", body.threadId)
    .eq("project_id", body.projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!thread) return NextResponse.json({ error: "Conversa inválida." }, { status: 403 });

  const kind = body.job.kind ?? "initial";
  const stages = stagedStages(kind);
  const stage = stages[body.job.nextStage];
  if (!stage) return NextResponse.json({ error: "A construção já foi concluída." }, { status: 409 });
  const prompt = buildStagePrompt(body.job.masterPrompt, stage, body.job.nextStage, stages.length, kind);
  const requestId = crypto.randomUUID();
  const reservation = await reserveGeneration({
    supabase,
    userId: user.id,
    projectId: body.projectId,
    prompt,
    limit: plan.maxGenerationsPerMonth,
    unlimited: owner,
    requestId,
    kind: "app",
  });
  if (reservation.error) {
    return NextResponse.json({ error: "Não foi possível reservar esta etapa." }, { status: 503 });
  }
  if (reservation.limitReached) {
    return NextResponse.json({ error: `Limite do plano ${plan.name} atingido.`, limitReached: true }, { status: 402 });
  }
  if (reservation.inProgress || reservation.duplicateCompleted) {
    const { data: existing } = await supabase
      .from("staged_generation_jobs")
      .select("id,status,updated_at")
      .eq("project_id", body.projectId)
      .maybeSingle();
    return NextResponse.json({
      job: existing ?? null,
      duplicate: true,
      completed: reservation.duplicateCompleted === true,
    }, { status: reservation.duplicateCompleted ? 200 : 202 });
  }
  if (!reservation.id) {
    return NextResponse.json({ error: "A reserva da etapa não retornou um identificador." }, { status: 503 });
  }

  const costMode = body.costMode === "economy" || body.costMode === "premium"
    ? body.costMode
    : "auto";
  const payload: BackgroundGenerationPayload = {
    version: BACKGROUND_GENERATION_VERSION,
    projectId: body.projectId,
    threadId: body.threadId,
    userId: user.id,
    stagedJob: stagedJobForCloud(body.job),
    stageIndex: body.job.nextStage,
    requestId,
    reservationId: reservation.id,
    name: String(body.name || "App").slice(0, 120),
    costMode,
    queuedAt: new Date().toISOString(),
    ...(body.currentApp ? { currentApp: body.currentApp } : {}),
  };
  const { data, error } = await supabase
    .from("staged_generation_jobs")
    .upsert({
      project_id: body.projectId,
      thread_id: body.threadId,
      user_id: user.id,
      status: "queued",
      payload,
      attempts: 0,
      next_attempt_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      last_error: null,
      completed_at: null,
    }, { onConflict: "project_id" })
    .select("id,status,updated_at")
    .single();
  if (error) {
    await finalizeGeneration(supabase, reservation.id, {
      status: "failed",
      errorCode: "queue_write_failed",
      errorMessage: error.message,
      metadata: { requestId, background: true },
    });
    return NextResponse.json({ error: "Não foi possível colocar a etapa na fila." }, { status: 503 });
  }
  return NextResponse.json({ job: data }, { status: 202 });
}

export async function DELETE(req: NextRequest) {
  const { supabase, user } = await context();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId || !isUuid(projectId)) {
    return NextResponse.json({ error: "Projeto inválido." }, { status: 400 });
  }
  const { data: job } = await supabase
    .from("staged_generation_jobs")
    .select("payload")
    .eq("project_id", projectId)
    .maybeSingle();
  const payload = job?.payload as { reservationId?: unknown; requestId?: unknown } | null;
  const reservationId = typeof payload?.reservationId === "string" ? payload.reservationId : null;
  const requestId = typeof payload?.requestId === "string" ? payload.requestId : null;
  const purge = req.nextUrl.searchParams.get("purge") === "1";
  if (purge) {
    const { error } = await supabase
      .from("staged_generation_jobs")
      .delete()
      .eq("project_id", projectId)
      .in("status", ["completed", "failed", "cancelled"]);
    if (error) return NextResponse.json({ error: "Não foi possível limpar a etapa finalizada." }, { status: 503 });
    return NextResponse.json({ purged: true });
  }
  const { error } = await supabase
    .from("staged_generation_jobs")
    .update({
      status: "cancelled",
      locked_at: null,
      locked_by: null,
      completed_at: new Date().toISOString(),
    })
    .eq("project_id", projectId)
    .in("status", ["active", "queued", "retry"]);
  if (error) return NextResponse.json({ error: "Não foi possível cancelar." }, { status: 503 });
  await finalizeGeneration(supabase, reservationId, {
    status: "failed",
    errorCode: "cancelled",
    errorMessage: "Geração em segundo plano cancelada pelo usuário.",
    metadata: { requestId, background: true, cancelled: true },
  });
  return NextResponse.json({ cancelled: true });
}
