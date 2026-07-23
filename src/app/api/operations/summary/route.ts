import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOwner } from "@/lib/access";
import { summarizeGenerationMetrics } from "@/lib/engine/observability";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!isOwner({ role: profile?.role, email: user.email })) {
    return NextResponse.json({ error: "Acesso exclusivo do administrador." }, { status: 403 });
  }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Service role não configurada." }, { status: 503 });
  const since = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  let migrationRequired = false;

  let generations: any[] = [];
  const observed = await admin
    .from("generations")
    .select("id, project_id, status, provider, model, cost_usd, duration_ms, error_code, error_message, attempt, kind, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);
  if (observed.error) {
    migrationRequired = true;
    const legacy = await admin
      .from("generations")
      .select("id, project_id, status, provider, model, cost_usd, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);
    generations = legacy.data ?? [];
  } else {
    generations = observed.data ?? [];
  }

  const { data: projects } = await admin.from("projects").select("id, name");
  const projectNames: Record<string, string> = {};
  for (const project of projects ?? []) projectNames[project.id] = project.name || "Projeto sem nome";

  let runtimeEvents: any[] = [];
  const eventResult = await admin
    .from("runtime_events")
    .select("id, project_id, kind, message, fingerprint, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(100);
  if (eventResult.error) migrationRequired = true;
  else runtimeEvents = eventResult.data ?? [];

  const metrics = summarizeGenerationMetrics(generations);
  const costByProject: Record<string, { projectId: string; name: string; cost: number; generations: number }> = {};
  for (const row of generations) {
    const projectId = String(row.project_id || "");
    const current = costByProject[projectId] ?? {
      projectId,
      name: projectNames[projectId] || "Projeto removido",
      cost: 0,
      generations: 0,
    };
    current.cost += Math.max(0, Number(row.cost_usd) || 0);
    current.generations++;
    costByProject[projectId] = current;
  }
  const projectsByCost = Object.values(costByProject)
    .map((row) => ({ ...row, cost: Math.round(row.cost * 10000) / 10000 }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 8);

  return NextResponse.json({
    periodDays: 30,
    migrationRequired,
    metrics,
    projectsByCost,
    recentFailures: generations
      .filter((row) => row.status === "failed")
      .slice(0, 12)
      .map((row) => ({
        id: row.id,
        project: projectNames[row.project_id] || "Projeto removido",
        provider: row.provider || "—",
        model: row.model || "—",
        code: row.error_code || "não classificada",
        message: row.error_message || "Falha registrada antes da observabilidade detalhada.",
        attempt: Number(row.attempt) || 1,
        createdAt: row.created_at,
      })),
    runtime: {
      total: runtimeEvents.length,
      unique: new Set(runtimeEvents.map((row) => row.fingerprint)).size,
      recent: runtimeEvents.slice(0, 12).map((row) => ({
        id: row.id,
        project: projectNames[row.project_id] || "Projeto removido",
        kind: row.kind,
        message: row.message,
        createdAt: row.created_at,
      })),
    },
    generatedAt: new Date().toISOString(),
  });
}
