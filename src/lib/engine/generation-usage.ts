import type { SupabaseClient } from "@supabase/supabase-js";

interface ReserveArgs {
  supabase: SupabaseClient; userId: string; projectId: string;
  prompt: string; limit: number; unlimited?: boolean;
}
export interface ReservationResult { id: string | null; limitReached: boolean; error?: string; }

export async function reserveGeneration(args: ReserveArgs): Promise<ReservationResult> {
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
  values: { status: "completed" | "failed"; provider?: string | null; cost?: number; model?: string | null }
): Promise<void> {
  if (!id) return;
  const { error } = await supabase.rpc("finalize_generation", {
    p_generation_id: id, p_status: values.status, p_provider: values.provider ?? null,
    p_cost_usd: Math.max(0, values.cost ?? 0), p_model: values.model ?? null,
  });
  if (error) console.warn("[usage] não foi possível finalizar a geração", id, error.message);
}
