import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOwner } from "@/lib/access";
import { authorizeProjectOwner, isUuid } from "@/lib/engine/data-guard";
import {
  isCollectionName,
  PRIVATE_PERMISSIONS,
  type CollectionPermissions,
  type CollectionProfile,
} from "@/lib/engine/collection-access";
import {
  EMPTY_DATA_CONTRACT,
  isAppRole,
  normalizeDataContract,
  type DataContract,
} from "@/lib/engine/data-contract";

const SETTINGS_SELECT =
  "profile, public_read, public_insert, public_update, public_delete, authenticated_read, authenticated_insert, authenticated_update, authenticated_delete, owner_only, allowed_roles, authenticated_scope, data_contract";

const PROFILES: Record<Exclude<CollectionProfile, "custom">, CollectionPermissions> = {
  catalog: {
    ...PRIVATE_PERMISSIONS,
    profile: "catalog",
    public_read: true,
    owner_only: false,
  },
  form: {
    ...PRIVATE_PERMISSIONS,
    profile: "form",
    public_insert: true,
    owner_only: false,
  },
  authenticated: {
    ...PRIVATE_PERMISSIONS,
    profile: "authenticated",
    authenticated_read: true,
    authenticated_insert: true,
    authenticated_update: true,
    authenticated_delete: true,
    owner_only: false,
  },
  private: PRIVATE_PERMISSIONS,
};

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

function migrationPending(error: any): boolean {
  return error?.code === "42703" || /allowed_roles|authenticated_scope|data_contract|role/i.test(error?.message || "");
}

function withAdvancedDefaults(data: any): CollectionPermissions {
  return {
    ...PRIVATE_PERMISSIONS,
    ...(data || {}),
    allowed_roles: Array.isArray(data?.allowed_roles) ? data.allowed_roles : [],
    authenticated_scope: data?.authenticated_scope === "all" ? "all" : "own",
    data_contract:
      data?.data_contract && typeof data.data_contract === "object"
        ? data.data_contract
        : EMPTY_DATA_CONTRACT,
  };
}

async function ownerContext(projectId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { response: bad("Não autenticado.", 401) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const owner = isOwner({ role: profile?.role, email: user.email });
  const access = await authorizeProjectOwner(supabase, projectId, user.id, owner);
  if (!access.allowed) return { response: bad(access.error ?? "Acesso negado.", access.status ?? 403) };
  const admin = createAdminClient();
  if (!admin) return { response: bad("Backend de dados não configurado.", 501) };
  return { admin };
}

function customPermissions(
  raw: any,
  allowedRoles: string[],
  authenticatedScope: "own" | "all",
  dataContract: DataContract
): CollectionPermissions {
  const value = (key: keyof CollectionPermissions) => raw?.[key] === true;
  return {
    profile: "custom",
    public_read: value("public_read"),
    public_insert: value("public_insert"),
    public_update: value("public_update"),
    public_delete: value("public_delete"),
    authenticated_read: value("authenticated_read"),
    authenticated_insert: value("authenticated_insert"),
    authenticated_update: value("authenticated_update"),
    authenticated_delete: value("authenticated_delete"),
    owner_only: value("owner_only"),
    allowed_roles: allowedRoles,
    authenticated_scope: authenticatedScope,
    data_contract: dataContract,
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return bad("projectId inválido");
  const collection = req.nextUrl.searchParams.get("collection") || "";
  if (!isCollectionName(collection)) return bad("Nome de coleção inválido.");
  const context = await ownerContext(projectId);
  if (context.response) return context.response;

  let { data, error } = await context.admin!
    .from("app_collection_settings")
    .select(SETTINGS_SELECT)
    .eq("project_id", projectId)
    .eq("collection", collection)
    .maybeSingle();
  if (error && migrationPending(error)) {
    const legacy = await context.admin!
      .from("app_collection_settings")
      .select(
        "profile, public_read, public_insert, public_update, public_delete, authenticated_read, authenticated_insert, authenticated_update, authenticated_delete, owner_only"
      )
      .eq("project_id", projectId)
      .eq("collection", collection)
      .maybeSingle();
    data = legacy.data ? withAdvancedDefaults(legacy.data) : null;
    error = legacy.error;
  }
  if (error) return bad(error.message, 500);
  return NextResponse.json({ settings: withAdvancedDefaults(data), configured: !!data });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return bad("projectId inválido");
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Corpo inválido");
  }
  const collection = body?.collection;
  const profile = body?.profile as CollectionProfile;
  if (!isCollectionName(collection)) return bad("Nome de coleção inválido.");
  if (!(["catalog", "form", "authenticated", "private", "custom"] as string[]).includes(profile)) {
    return bad("Perfil de acesso inválido.");
  }
  const context = await ownerContext(projectId);
  if (context.response) return context.response;

  const permissionInput = body?.permissions ?? {};
  const rolesRaw = body?.allowed_roles ?? permissionInput.allowed_roles ?? [];
  if (!Array.isArray(rolesRaw) || rolesRaw.length > 40 || !rolesRaw.every(isAppRole)) {
    return bad("Papéis permitidos inválidos.");
  }
  const allowedRoles = Array.from(new Set(rolesRaw as string[]));
  const scopeRaw = body?.authenticated_scope ?? permissionInput.authenticated_scope ?? "own";
  if (scopeRaw !== "own" && scopeRaw !== "all") return bad("Escopo autenticado inválido.");

  const contractResult = normalizeDataContract(
    body?.data_contract ?? permissionInput.data_contract ?? EMPTY_DATA_CONTRACT
  );
  if (!contractResult.contract) {
    return NextResponse.json(
      { error: "Contrato de dados inválido.", fieldErrors: contractResult.errors },
      { status: 422 }
    );
  }

  const settings =
    profile === "custom"
      ? customPermissions(
          permissionInput,
          allowedRoles,
          scopeRaw,
          contractResult.contract
        )
      : {
          ...PROFILES[profile],
          allowed_roles: allowedRoles,
          authenticated_scope: scopeRaw,
          data_contract: contractResult.contract,
        };
  const payload = { project_id: projectId, collection, ...settings };
  let { data, error } = await context.admin!
    .from("app_collection_settings")
    .upsert(
      payload,
      { onConflict: "project_id,collection" }
    )
    .select(SETTINGS_SELECT)
    .single();
  if (error && migrationPending(error)) {
    const {
      allowed_roles: _roles,
      authenticated_scope: _scope,
      data_contract: _contract,
      ...legacyPayload
    } = payload;
    const legacy = await context.admin!
      .from("app_collection_settings")
      .upsert(legacyPayload, { onConflict: "project_id,collection" })
      .select(
        "profile, public_read, public_insert, public_update, public_delete, authenticated_read, authenticated_insert, authenticated_update, authenticated_delete, owner_only"
      )
      .single();
    data = legacy.data ? withAdvancedDefaults(legacy.data) : null;
    error = legacy.error;
  }
  if (error) return bad(error.message, 500);
  return NextResponse.json({
    settings: withAdvancedDefaults(data),
    configured: true,
    advancedReady: !!(data as any)?.data_contract,
  });
}
