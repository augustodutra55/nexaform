import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { isOwner } from "@/lib/access";
import { isUuid } from "@/lib/engine/data-guard";
import {
  EMPTY_DATA_CONTRACT,
  type DataContract,
} from "@/lib/engine/data-contract";

export type CollectionOperation = "read" | "insert" | "update" | "delete";
export type CollectionProfile = "catalog" | "form" | "authenticated" | "private" | "custom";

export interface CollectionPermissions {
  profile: CollectionProfile;
  public_read: boolean;
  public_insert: boolean;
  public_update: boolean;
  public_delete: boolean;
  authenticated_read: boolean;
  authenticated_insert: boolean;
  authenticated_update: boolean;
  authenticated_delete: boolean;
  owner_only: boolean;
  allowed_roles: string[];
  authenticated_scope: "own" | "all";
  data_contract: DataContract;
}

export interface CollectionAccess {
  allowed: boolean;
  status?: number;
  error?: string;
  actor: "owner" | "app_user" | "public";
  appUserId?: string | null;
  appUserRole?: string | null;
  /** true quando o acesso autenticado deve enxergar somente os próprios registros. */
  scopeToAppUser?: boolean;
  permissions?: CollectionPermissions;
}

const COLLECTION_RE = /^[a-zA-Z0-9À-ÿ_-]{1,80}$/;

export function isCollectionName(value: string): boolean {
  return COLLECTION_RE.test(value);
}

export const PRIVATE_PERMISSIONS: CollectionPermissions = {
  profile: "private",
  public_read: false,
  public_insert: false,
  public_update: false,
  public_delete: false,
  authenticated_read: false,
  authenticated_insert: false,
  authenticated_update: false,
  authenticated_delete: false,
  owner_only: true,
  allowed_roles: [],
  authenticated_scope: "own",
  data_contract: EMPTY_DATA_CONTRACT,
};

function permissionError(op: CollectionOperation, actor: "app_user" | "public"): string {
  if (actor === "public" && op !== "read") {
    return op === "insert"
      ? "Esta coleção não permite envios públicos."
      : "Somente o administrador pode alterar este registro.";
  }
  if (actor === "public") return "Esta coleção não permite leitura pública.";
  return op === "read"
    ? "Sua conta não tem acesso aos dados desta coleção."
    : "Sua conta não pode realizar esta operação.";
}

export interface AppUserActor {
  id: string;
  role: string;
}

async function appUserFromRequest(
  req: Request,
  admin: SupabaseClient,
  projectId: string
): Promise<AppUserActor | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const { data: session } = await admin
    .from("app_sessions")
    .select("user_id, expires_at")
    .eq("token", tokenHash)
    .eq("token_hashed", true)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!session || new Date(session.expires_at) <= new Date()) return null;
  let { data: appUser, error: appUserError } = await admin
    .from("app_users")
    .select("id, role")
    .eq("id", session.user_id)
    .eq("project_id", projectId)
    .maybeSingle();
  if (appUserError) {
    const legacy = await admin
      .from("app_users")
      .select("id")
      .eq("id", session.user_id)
      .eq("project_id", projectId)
      .maybeSingle();
    appUser = legacy.data ? { ...legacy.data, role: "user" } : null;
  }
  if (!appUser) return null;
  return { id: appUser.id, role: appUser.role || "user" };
}

function normalizedPermissions(configured: Partial<CollectionPermissions> | null): CollectionPermissions {
  const raw = configured ?? {};
  return {
    ...PRIVATE_PERMISSIONS,
    ...raw,
    allowed_roles: Array.isArray(raw.allowed_roles) ? raw.allowed_roles : [],
    authenticated_scope: raw.authenticated_scope === "all" ? "all" : "own",
    data_contract:
      raw.data_contract && typeof raw.data_contract === "object"
        ? (raw.data_contract as DataContract)
        : EMPTY_DATA_CONTRACT,
  };
}

async function collectionPermissions(
  admin: SupabaseClient,
  projectId: string,
  collection: string
): Promise<CollectionPermissions> {
  const current = await admin
    .from("app_collection_settings")
    .select(
      "profile, public_read, public_insert, public_update, public_delete, authenticated_read, authenticated_insert, authenticated_update, authenticated_delete, owner_only, allowed_roles, authenticated_scope, data_contract"
    )
    .eq("project_id", projectId)
    .eq("collection", collection)
    .maybeSingle();
  if (!current.error) return normalizedPermissions(current.data as CollectionPermissions | null);

  // Implantação sem interrupção: enquanto a migration 0012 ainda não foi
  // aplicada, mantém as permissões anteriores e usa contrato aberto/role user.
  const legacy = await admin
    .from("app_collection_settings")
    .select(
      "profile, public_read, public_insert, public_update, public_delete, authenticated_read, authenticated_insert, authenticated_update, authenticated_delete, owner_only"
    )
    .eq("project_id", projectId)
    .eq("collection", collection)
    .maybeSingle();
  return normalizedPermissions(legacy.data as CollectionPermissions | null);
}

export function decideCollectionAccess(
  permissions: CollectionPermissions,
  operation: CollectionOperation,
  appUser: AppUserActor | null
): Pick<CollectionAccess, "allowed" | "actor" | "appUserId" | "appUserRole" | "scopeToAppUser" | "error" | "status"> {
  const actor = appUser ? "app_user" : "public";
  if (permissions.owner_only) {
    return {
      allowed: false,
      status: 403,
      error: "Esta coleção é privada.",
      actor,
      appUserId: appUser?.id ?? null,
      appUserRole: appUser?.role ?? null,
    };
  }

  const publicAllowed = permissions[`public_${operation}` as keyof CollectionPermissions] === true;
  const roleAllowed =
    !!appUser &&
    (permissions.allowed_roles.length === 0 || permissions.allowed_roles.includes(appUser.role));
  const authenticatedAllowed =
    roleAllowed && permissions[`authenticated_${operation}` as keyof CollectionPermissions] === true;

  if (!publicAllowed && !authenticatedAllowed) {
    const roleDenied =
      !!appUser &&
      permissions.allowed_roles.length > 0 &&
      !permissions.allowed_roles.includes(appUser.role);
    return {
      allowed: false,
      status: 403,
      error: roleDenied ? "Seu perfil não tem acesso a esta coleção." : permissionError(operation, actor),
      actor,
      appUserId: appUser?.id ?? null,
      appUserRole: appUser?.role ?? null,
    };
  }

  return {
    allowed: true,
    actor,
    appUserId: appUser?.id ?? null,
    appUserRole: appUser?.role ?? null,
    scopeToAppUser: authenticatedAllowed && permissions.authenticated_scope === "own",
  };
}

/**
 * Autoriza uma operação de window.AD. Toda decisão é resolvida no servidor:
 * projeto, dono, sessão do usuário final e política específica da coleção.
 */
export async function authorizeCollectionOperation(
  req: Request,
  supabase: SupabaseClient,
  admin: SupabaseClient,
  projectId: string,
  collection: string,
  operation: CollectionOperation
): Promise<CollectionAccess> {
  const denied = (status: number, error: string): CollectionAccess => ({
    allowed: false,
    status,
    error,
    actor: "public",
  });
  if (!isUuid(projectId)) return denied(400, "projectId inválido");
  if (!isCollectionName(collection)) return denied(400, "Nome de coleção inválido.");

  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("id, user_id, published")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) return denied(500, "Não foi possível validar o projeto.");
  if (!project) return denied(404, "Projeto não encontrado.");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  let globalOwner = false;
  if (user) {
    const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
    globalOwner = isOwner({ role: profile?.role, email: user.email });
  }
  if ((user && user.id === project.user_id) || globalOwner) {
    const permissions = await collectionPermissions(admin, projectId, collection);
    return {
      allowed: true,
      actor: "owner",
      appUserId: null,
      appUserRole: null,
      scopeToAppUser: false,
      permissions,
    };
  }

  if (!project.published) return denied(403, "Este projeto ainda não está publicado.");

  const appUser = await appUserFromRequest(req, admin, projectId);
  const actor = appUser ? "app_user" : "public";
  const permissions = await collectionPermissions(admin, projectId, collection);
  const decision = decideCollectionAccess(permissions, operation, appUser);
  return { ...decision, actor, permissions };
}
