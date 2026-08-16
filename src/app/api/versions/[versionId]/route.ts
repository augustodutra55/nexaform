import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/access";
import { authorizeProjectOwner, isUuid } from "@/lib/engine/data-guard";
import { checkpointLabel } from "@/lib/history/version-history";

/**
 * Renomeia o rótulo de uma versão (ex.: marcar como "Aprovado pelo cliente").
 *
 * PATCH /api/versions/[versionId]
 * Body: { label: string }
 */
export const maxDuration = 20;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ versionId: string }> }
) {
  const { versionId } = await params;
  if (!versionId || !isUuid(versionId)) {
    return NextResponse.json({ error: "Versão inválida." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }
  const label = checkpointLabel(body?.label);

  const { data: version, error: versionError } = await supabase
    .from("versions")
    .select("id, project_id")
    .eq("id", versionId)
    .maybeSingle();
  if (versionError) {
    return NextResponse.json({ error: "Não foi possível carregar a versão." }, { status: 503 });
  }
  if (!version) {
    return NextResponse.json({ error: "Versão não encontrada." }, { status: 404 });
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const owner = isOwner({ role: profile?.role, email: user.email });
  const access = await authorizeProjectOwner(supabase, version.project_id, user.id, owner);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status ?? 403 });
  }

  const { data: updated, error: updateError } = await supabase
    .from("versions")
    .update({ label })
    .eq("id", versionId)
    .select("id, label, created_at")
    .single();
  if (updateError) {
    return NextResponse.json({ error: "Não foi possível renomear a versão." }, { status: 503 });
  }

  return NextResponse.json({ version: updated });
}
