import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildGenerationPlan } from "@/lib/engine/generation-plan";
import { nextPlanStatus, renderPlanSummary, toProjectPlanView, type ProjectPlanStatus } from "@/lib/engine/plan-agent";
import { isUuid } from "@/lib/engine/data-guard";

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

async function context(projectId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { response: bad("Não autenticado.", 401) };
  const { data: project, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return { response: bad(error.message, 500) };
  if (!project) return { response: bad("Projeto não encontrado.", 404) };
  return { supabase, user };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return bad("projectId inválido.");
  const resolved = await context(projectId);
  if (resolved.response) return resolved.response;
  const { data, error } = await resolved.supabase!
    .from("project_plans")
    .select("id, prompt, plan, status, approved_at, executed_at, created_at, updated_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return bad(error.message, 500);
  const plans = data || [];
  // Envelope padronizado (views) além das linhas cruas, para o plan-card.
  return NextResponse.json({ plans, views: plans.map((row: any) => toProjectPlanView(row)) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return bad("projectId inválido.");
  const resolved = await context(projectId);
  if (resolved.response) return resolved.response;

  let body: { prompt?: string; planId?: string; action?: "approve" | "execute" | "complete" | "cancel" } = {};
  try { body = await req.json(); } catch { return bad("Corpo inválido."); }

  if (body.prompt?.trim()) {
    const prompt = body.prompt.trim();
    const plan = buildGenerationPlan(prompt);
    const { data, error } = await resolved.supabase!
      .from("project_plans")
      .insert({ project_id: projectId, user_id: resolved.user!.id, prompt, plan, status: "draft" })
      .select("id, prompt, plan, status, approved_at, executed_at, created_at, updated_at")
      .single();
    if (error) return bad(error.message, 500);
    return NextResponse.json(
      { plan: data, view: toProjectPlanView(data as any), summary: renderPlanSummary(plan), mode: "plan" },
      { status: 201 }
    );
  }

  if (!body.planId || !isUuid(body.planId) || !body.action) return bad("Informe prompt ou planId/action.");
  const { data: current, error: readError } = await resolved.supabase!
    .from("project_plans")
    .select("id, status")
    .eq("id", body.planId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (readError) return bad(readError.message, 500);
  if (!current) return bad("Plano não encontrado.", 404);

  let status: ProjectPlanStatus;
  try {
    status = nextPlanStatus(current.status as ProjectPlanStatus, body.action);
  } catch (error) {
    return bad(error instanceof Error ? error.message : "Transição inválida.", 409);
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status, updated_at: now };
  if (body.action === "approve") patch.approved_at = now;
  if (body.action === "execute") patch.executed_at = now;
  const { data, error } = await resolved.supabase!
    .from("project_plans")
    .update(patch)
    .eq("id", body.planId)
    .eq("project_id", projectId)
    .select("id, prompt, plan, status, approved_at, executed_at, created_at, updated_at")
    .single();
  if (error) return bad(error.message, 500);
  return NextResponse.json({
    plan: data,
    view: toProjectPlanView(data as any),
    mode: body.action === "execute" ? "agent" : "plan",
  });
}
