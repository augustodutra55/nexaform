import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/engine/data-guard";

/**
 * Analytics de visitas dos sites publicados.
 * POST → incrementa o contador do projeto (chamado uma vez por carregamento do
 * site publicado). GET → devolve a contagem atual (o dono mostra "N visitas").
 * Agregado e anônimo: não guarda IP, user-agent nem qualquer dado do visitante.
 */

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_req: NextRequest, { params }: { params: { projectId: string } }) {
  const projectId = params.projectId;
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: "projectId inválido" }, { status: 400 });
  // Anti-flood leve (não é auth; só evita abuso grosseiro do contador).
  if (!rateLimit(`view:${projectId}`, 120)) return NextResponse.json({ ok: true, skipped: true });

  const supabase = createClient();
  const { data, error } = await supabase.rpc("bump_view", { p: projectId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, views: data ?? null });
}

export async function GET(_req: NextRequest, { params }: { params: { projectId: string } }) {
  const projectId = params.projectId;
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: "projectId inválido" }, { status: 400 });
  const supabase = createClient();
  const { data } = await supabase.from("site_stats").select("views").eq("project_id", projectId).maybeSingle();
  return NextResponse.json({ views: data?.views ?? 0 });
}
