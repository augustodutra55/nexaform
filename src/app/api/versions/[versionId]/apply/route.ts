import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/access";
import { authorizeProjectOwner, isUuid } from "@/lib/engine/data-guard";
import { applyAcceptedFiles } from "@/lib/engine/operation-blocks";
import { isAppCode, isMultiFile, type AppCode, type AppFile } from "@/lib/engine/app-types";

/**
 * Aplica mudanças de arquivo aceitas no diff a uma versão (Fase 3).
 *
 * POST /api/versions/[versionId]/apply
 * Body: { accepted: [{ path, content|null }] }  (content null/"" remove o arquivo)
 *
 * Carrega o schema (AppCode) da versão, aplica os arquivos aceitos com
 * `applyAcceptedFiles` (operation-blocks.ts) e grava o resultado de volta no
 * JSON da versão — a versão visível passa a refletir as mudanças confirmadas.
 * Rejeitar uma mudança é a ausência dela no array `accepted`; nada é aplicado.
 */
export const maxDuration = 30;

interface AcceptedChange {
  path: string;
  content: string | null;
}

function sanitizeAccepted(value: unknown): AcceptedChange[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const accepted: AcceptedChange[] = [];
  for (const raw of value.slice(0, 200)) {
    if (!raw || typeof raw !== "object") continue;
    const path = typeof (raw as any).path === "string" ? (raw as any).path.trim() : "";
    if (!path) continue;
    const content = (raw as any).content;
    accepted.push({
      path,
      content: content === null || content === undefined ? null : String(content),
    });
  }
  return accepted.length ? accepted : null;
}

function versionFiles(schema: AppCode): AppFile[] {
  if (isMultiFile(schema)) return schema.files;
  if (typeof schema.code === "string") return [{ path: "App.jsx", content: schema.code }];
  return [];
}

export async function POST(
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
  const accepted = sanitizeAccepted(body?.accepted);
  if (!accepted) {
    return NextResponse.json({ error: "Nenhuma alteração aceita foi enviada." }, { status: 400 });
  }

  const { data: version, error: versionError } = await supabase
    .from("versions")
    .select("id, project_id, schema, label")
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

  if (!isAppCode(version.schema)) {
    return NextResponse.json({ error: "Esta versão não é um aplicativo com arquivos editáveis." }, { status: 422 });
  }
  const schema = version.schema as AppCode;
  const originalFiles = versionFiles(schema);
  if (!originalFiles.length) {
    return NextResponse.json({ error: "A versão não tem arquivos para atualizar." }, { status: 422 });
  }

  const nextFiles = applyAcceptedFiles(originalFiles, accepted);
  if (!nextFiles) {
    return NextResponse.json({ error: "As alterações aceitas não modificam a versão." }, { status: 409 });
  }

  let entry = isMultiFile(schema) ? schema.entry : "App.jsx";
  if (!nextFiles.some((file) => file.path === entry)) {
    entry = nextFiles.find((file) => /(^|\/)App\.(jsx|tsx|js|ts)$/.test(file.path))?.path ?? nextFiles[0].path;
  }
  const nextSchema: AppCode = {
    kind: "app",
    name: schema.name ?? "App",
    description: schema.description ?? "",
    files: nextFiles,
    entry,
    provider: schema.provider,
  };

  const { data: updated, error: updateError } = await supabase
    .from("versions")
    .update({ schema: nextSchema })
    .eq("id", versionId)
    .select("id, label, created_at, schema")
    .single();
  if (updateError) {
    return NextResponse.json({ error: "Não foi possível salvar as alterações na versão." }, { status: 503 });
  }

  return NextResponse.json({ version: updated, files: nextFiles.length });
}
