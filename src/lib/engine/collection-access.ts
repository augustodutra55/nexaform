import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { isOwner } from "@/lib/access";
import { isUuid } from "@/lib/engine/data-guard";

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
}

export interface CollectionAccess {
  allowed: boolean;
  status?: number;
  error?: string;
  actor: "owner" | "app_user" | "public";
  appUserId?: string | null;
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

async function appUserFromRequest(
  req: Request,
  admin: SupabaseClient,
  projectId: string
): Promise<string | null> {
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
  return session.user_id;
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
    return { allowed: true, actor: "owner", appUserId: null, scopeToAppUser: false };
  }

  if (!project.published) return denied(403, "Este projeto ainda não está publicado.");

  const appUserId = await appUserFromRequest(req, admin, projectId);
  const actor = appUserId ? "app_user" : "public";
  const { data: configured } = await admin
    .from("app_collection_settings")
    .select(
      "profile, public_read, public_insert, public_update, public_delete, authenticated_read, authenticated_insert, authenticated_update, authenticated_delete, owner_only"
    )
    .eq("project_id", projectId)
    .eq("collection", collection)
    .maybeSingle();
  const permissions = (configured as CollectionPermissions | null) ?? PRIVATE_PERMISSIONS;
  if (permissions.owner_only) {
    return { allowed: false, status: 403, error: "Esta coleção é privada.", actor, appUserId, permissions };
  }

  const publicAllowed = permissions[`public_${operation}` as keyof CollectionPermissions] === true;
  const authenticatedAllowed =
    !!appUserId && permissions[`authenticated_${operation}` as keyof CollectionPermissions] === true;
  if (!publicAllowed && !authenticatedAllowed) {
    return {
      allowed: false,
      status: 403,
      error: permissionError(operation, actor),
      actor,
      appUserId,
      permissions,
    };
  }

  return {
    allowed: true,
    actor,
    appUserId,
    permissions,
    scopeToAppUser: authenticatedAllowed && !publicAllowed,
  };
}
