import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/access";
import { authorizeProjectOwner, isUuid } from "@/lib/engine/data-guard";
import { checkpointLabel } from "@/lib/history/version-history";

/**
 * Cria um checkpoint: uma versão nomeada com o estado atual do projeto, para o
 * criador marcar um marco (ex.: "Entrega 1", "Aprovado pelo cliente") e poder
 * voltar a ele depois com segurança.
 *
 * POST /api/checkpoints/[projectId]
 * Body: { label?: string }
 */
export const maxDuration = 20;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  if (!projectId || !isUuid(projectId)) {
    return NextResponse.json({ error: "Projeto inválido." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const label = checkpointLabel(body?.label);

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const owner = isOwner({ role: profile?.role, email: user.email });
  const access = await authorizeProjectOwner(supabase, projectId, user.id, owner);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status ?? 403 });
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, schema")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) {
    return NextResponse.json({ error: "Não foi possível carregar o projeto." }, { status: 503 });
  }
  if (!project || project.schema == null) {
    return NextResponse.json({ error: "Gere a primeira versão antes de criar um checkpoint." }, { status: 422 });
  }

  const { data: created, error: insertError } = await supabase
    .from("versions")
    .insert({ project_id: projectId, schema: project.schema, label })
    .select("id, label, created_at, schema")
    .single();
  if (insertError) {
    return NextResponse.json({ error: "Não foi possível criar o checkpoint." }, { status: 503 });
  }

  return NextResponse.json({ version: created });
}
