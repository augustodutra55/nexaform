import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/access";
import { authorizeProjectOwner, isUuid } from "@/lib/engine/data-guard";
import {
  backgroundJobLabel,
  isTerminalJobStatus,
  type BackgroundJobStatus,
} from "@/lib/engine/background-jobs";

/**
 * Status LEVE da fila durável (Fase 2 — paridade Lovable).
 *
 * GET /api/generation-jobs/queue?projectId=<uuid>
 *
 * Devolve apenas o estado do último job do projeto lendo a tabela criada em
 * `0014_durable_generation_jobs.sql`/`0015_background_generation_queue.sql`
 * (`staged_generation_jobs`), SEM o payload pesado — o snapshot `currentApp`
 * pode ter centenas de KB e não deve viajar em um polling de 2s. O rótulo em
 * PT-BR vem de `backgroundJobLabel(...)` (background-jobs.ts), o mesmo usado
 * pelo card do painel; nada é duplicado.
 *
 * Resposta: { job: null } quando não há job, ou
 * { job: { id, status, active, attempts, label, stageIndex, kind, threadId,
 *          lastError, updatedAt, completedAt, nextAttemptAt } }
 *
 * O cliente busca o snapshot completo em GET /api/generation-jobs apenas
 * quando `status` é terminal (para aplicar o resultado ou retomar).
 */
export const maxDuration = 15;

const VALID_STATUSES = new Set<BackgroundJobStatus>([
  "active", "queued", "running", "retry", "completed", "failed", "cancelled",
]);

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId || !isUuid(projectId)) {
    return NextResponse.json({ error: "Projeto inválido." }, { status: 400 });
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const owner = isOwner({ role: profile?.role, email: user.email });
  const access = await authorizeProjectOwner(supabase, projectId, user.id, owner);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status ?? 403 });
  }

  // Seleção cirúrgica: campos escalares + três chaves do payload JSONB. O
  // snapshot currentApp/result fica fora da resposta de propósito.
  const { data, error } = await supabase
    .from("staged_generation_jobs")
    .select("id,status,attempts,last_error,updated_at,completed_at,next_attempt_at,stage_index:payload->stageIndex,kind:payload->stagedJob->kind,thread_id:payload->threadId")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "Não foi possível consultar a fila." }, { status: 503 });
  }
  if (!data) return NextResponse.json({ job: null });

  const status: BackgroundJobStatus = VALID_STATUSES.has(data.status as BackgroundJobStatus)
    ? (data.status as BackgroundJobStatus)
    : "active";
  const attempts = Number.isInteger(data.attempts) ? Number(data.attempts) : 0;

  return NextResponse.json({
    job: {
      id: data.id,
      status,
      active: !isTerminalJobStatus(status),
      attempts,
      label: backgroundJobLabel(status, attempts),
      stageIndex: Number.isInteger(data.stage_index) ? Number(data.stage_index) : 0,
      kind: data.kind === "refinement" ? "refinement" : "initial",
      threadId: typeof data.thread_id === "string" ? data.thread_id : "",
      lastError: typeof data.last_error === "string" ? data.last_error : null,
      updatedAt: data.updated_at ?? null,
      completedAt: data.completed_at ?? null,
      nextAttemptAt: data.next_attempt_at ?? null,
    },
  });
}
