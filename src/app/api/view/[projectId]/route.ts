import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeRateLimit, requestRateKey } from "@/lib/engine/data-guard";

/**
 * Analytics de visitas dos sites publicados.
 * POST → incrementa o contador do projeto (chamado uma vez por carregamento do
 * site publicado). GET → devolve a contagem atual (o dono mostra "N visitas").
 * Agregado e anônimo: não guarda IP, user-agent nem qualquer dado do visitante.
 */

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: "projectId inválido" }, { status: 400 });
  // Anti-flood leve (não é auth; só evita abuso grosseiro do contador).
  if (!(await consumeRateLimit(`view:${projectId}:${requestRateKey(req)}`, 20))) return NextResponse.json({ ok: true, skipped: true });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Analytics não configurado." }, { status: 501 });
  const { data: project } = await admin.from("projects").select("id").eq("id", projectId).eq("published", true).maybeSingle();
  if (!project) return NextResponse.json({ error: "Projeto publicado não encontrado." }, { status: 404 });
  const { data, error } = await admin.rpc("bump_view", { p: projectId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, views: data ?? null });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: "projectId inválido" }, { status: 400 });
  const supabase = await createClient();
  const { data } = await supabase.from("site_stats").select("views").eq("project_id", projectId).maybeSingle();
  return NextResponse.json({ views: data?.views ?? 0 });
}
