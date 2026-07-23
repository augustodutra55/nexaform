import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOwner } from "@/lib/access";
import { authorizeProjectOwner, isUuid } from "@/lib/engine/data-guard";
import { buildBackendBlueprint, type BackendCollectionBlueprint } from "@/lib/engine/backend-blueprint";
import { PRIVATE_PERMISSIONS } from "@/lib/engine/collection-access";
import { isAppCode } from "@/lib/engine/app-types";

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

async function context(projectId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { response: bad("Não autenticado.", 401) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const access = await authorizeProjectOwner(
    supabase,
    projectId,
    user.id,
    isOwner({ role: profile?.role, email: user.email })
  );
  if (!access.allowed) return { response: bad(access.error || "Acesso negado.", access.status || 403) };
  const admin = createAdminClient();
  if (!admin) return { response: bad("Backend de dados não configurado.", 501) };
  const { data: project, error } = await admin
    .from("projects")
    .select("id, schema, meta")
    .eq("id", projectId)
    .maybeSingle();
  if (error) return { response: bad(error.message, 500) };
  if (!project || !isAppCode(project.schema)) {
    return { response: bad("Este projeto ainda não possui um aplicativo gerado.", 422) };
  }
  return { admin, project };
}

function settingsFor(item: BackendCollectionBlueprint) {
  const base = {
    ...PRIVATE_PERMISSIONS,
    project_id: "",
    collection: item.collection,
    profile: item.profile === "custom" ? "private" : item.profile,
    allowed_roles: item.allowedRoles,
    authenticated_scope: item.authenticatedScope,
    data_contract: item.dataContract,
  };
  if (item.profile === "catalog") {
    return { ...base, public_read: true, owner_only: false };
  }
  if (item.profile === "form") {
    return { ...base, public_insert: true, owner_only: false };
  }
  if (item.profile === "authenticated") {
    return {
      ...base,
      authenticated_read: true,
      authenticated_insert: true,
      authenticated_update: true,
      authenticated_delete: true,
      owner_only: false,
    };
  }
  return base;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return bad("projectId inválido.");
  const resolved = await context(projectId);
  if (resolved.response) return resolved.response;
  const blueprint = buildBackendBlueprint(resolved.project!.schema);
  return NextResponse.json({
    blueprint,
    provisioning: resolved.project!.meta?.backendProvisioning || null,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return bad("projectId inválido.");
  let body: { apply?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // Corpo vazio equivale a uma análise sem escrita.
  }
  const resolved = await context(projectId);
  if (resolved.response) return resolved.response;
  const blueprint = buildBackendBlueprint(resolved.project!.schema);
  if (body.apply !== true) return NextResponse.json({ blueprint, applied: false });

  const configured: string[] = [];
  for (const item of blueprint.collections) {
    const payload = { ...settingsFor(item), project_id: projectId };
    const { error } = await resolved.admin!
      .from("app_collection_settings")
      .upsert(payload, { onConflict: "project_id,collection" });
    if (error) {
      return bad(`Não foi possível configurar “${item.collection}”: ${error.message}`, 500);
    }
    configured.push(item.collection);
  }

  const updatedAt = new Date().toISOString();
  const provisioning = {
    version: 1,
    status: blueprint.status,
    usesAuth: blueprint.usesAuth,
    collections: configured,
    warnings: blueprint.warnings,
    updatedAt,
  };
  const currentMeta =
    resolved.project!.meta && typeof resolved.project!.meta === "object"
      ? resolved.project!.meta
      : {};
  const { error: metaError } = await resolved.admin!
    .from("projects")
    .update({
      meta: { ...currentMeta, backendProvisioning: provisioning },
      updated_at: updatedAt,
    })
    .eq("id", projectId);
  if (metaError) return bad(metaError.message, 500);

  return NextResponse.json({
    blueprint,
    provisioning,
    applied: true,
  });
}

