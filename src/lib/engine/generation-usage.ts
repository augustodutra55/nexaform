import type { SupabaseClient } from "@supabase/supabase-js";

interface ReserveArgs {
  supabase: SupabaseClient; userId: string; projectId: string;
  prompt: string; limit: number; unlimited?: boolean;
  requestId?: string | null; kind?: "app" | "site";
}
export interface ReservationResult {
  id: string | null;
  limitReached: boolean;
  inProgress?: boolean;
  duplicateCompleted?: boolean;
  attempt?: number;
  observed?: boolean;
  error?: string;
}

function unavailableObservedRpc(error: { code?: string; message?: string } | null): boolean {
  const message = error?.message || "";
  return error?.code === "PGRST202"
    || error?.code === "42883"
    || /reserve_generation_observed|finalize_generation_observed|schema cache/i.test(message);
}

export async function reserveGeneration(args: ReserveArgs): Promise<ReservationResult> {
  if (args.requestId) {
    const { data, error } = await args.supabase.rpc("reserve_generation_observed", {
      p_project_id: args.projectId,
      p_limit: args.limit,
      p_prompt: args.prompt.slice(0, 2000),
      p_request_id: args.requestId,
      p_kind: args.kind ?? "app",
    });
    if (!error && data && typeof data === "object") {
      const state = String((data as any).state || "");
      const id = typeof (data as any).id === "string" ? (data as any).id : null;
      return {
        id,
        limitReached: state === "limit",
        inProgress: state === "in_progress",
        duplicateCompleted: state === "duplicate_completed",
        attempt: Math.max(1, Number((data as any).attempt) || 1),
        observed: true,
        error: state === "invalid" ? "Reserva de geração inválida." : undefined,
      };
    }
    if (error && !unavailableObservedRpc(error)) {
      return { id: null, limitReached: false, observed: true, error: error.message };
    }
  }

  if (args.unlimited) {
    const { data, error } = await args.supabase.from("generations").insert({
      user_id: args.userId, project_id: args.projectId, prompt: args.prompt.slice(0, 2000),
      provider: "pending", status: "pending",
    }).select("id").single();
    return { id: data?.id ?? null, limitReached: false, error: error?.message };
  }
  const { data, error } = await args.supabase.rpc("reserve_generation", {
    p_project_id: args.projectId, p_limit: args.limit, p_prompt: args.prompt.slice(0, 2000),
  });
  if (error) return { id: null, limitReached: false, error: error.message };
  return { id: typeof data === "string" ? data : null, limitReached: !data };
}

export async function finalizeGeneration(
  supabase: SupabaseClient, id: string | null,
  values: {
    status: "completed" | "failed";
    provider?: string | null;
    cost?: number;
    model?: string | null;
    durationMs?: number | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  if (!id) return;
  const observed = await supabase.rpc("finalize_generation_observed", {
    p_generation_id: id,
    p_status: values.status,
    p_provider: values.provider ?? null,
    p_cost_usd: Math.max(0, values.cost ?? 0),
    p_model: values.model ?? null,
    p_duration_ms: values.durationMs == null ? null : Math.max(0, Math.round(values.durationMs)),
    p_error_code: values.errorCode?.slice(0, 80) ?? null,
    p_error_message: values.errorMessage?.slice(0, 800) ?? null,
    p_metadata: values.metadata ?? {},
  });
  if (!observed.error) return;
  if (!unavailableObservedRpc(observed.error)) {
    console.warn("[usage] não foi possível finalizar a geração observada", id, observed.error.message);
    return;
  }
  const { error } = await supabase.rpc("finalize_generation", {
    p_generation_id: id, p_status: values.status, p_provider: values.provider ?? null,
    p_cost_usd: Math.max(0, values.cost ?? 0), p_model: values.model ?? null,
  });
  if (error) console.warn("[usage] não foi possível finalizar a geração", id, error.message);
}
