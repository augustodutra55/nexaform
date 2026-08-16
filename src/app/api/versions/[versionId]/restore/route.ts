import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/access";
import { authorizeProjectOwner, isUuid } from "@/lib/engine/data-guard";

/**
 * Restaura o projeto para uma versão anterior de forma atômica.
 *
 * POST /api/versions/[versionId]/restore
 *
 * Usa o RPC restore_project_version (migração 0016), que salva o estado atual
 * como snapshot de recuperação e troca o schema do projeto para a versão
 * escolhida dentro da mesma transação — nada é perdido ao voltar atrás.
 */
export const maxDuration = 20;

export async function POST(
  _req: NextRequest,
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

  const { data: version, error: versionError } = await supabase
    .from("versions")
    .select("id, project_id, label")
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

  const { data: result, error: rpcError } = await supabase.rpc("restore_project_version", {
    p_project_id: version.project_id,
    p_version_id: versionId,
  });
  if (rpcError) {
    return NextResponse.json({ error: "Não foi possível restaurar a versão." }, { status: 503 });
  }

  const row = Array.isArray(result) ? result[0] : result;
  return NextResponse.json({
    restored: true,
    schema: row?.restored_schema ?? null,
    recoveryVersionId: row?.recovery_version_id ?? null,
    restoredVersionId: row?.restored_version_id ?? versionId,
    label: version.label ?? null,
  });
}
