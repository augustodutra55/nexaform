import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOwner } from "@/lib/access";
import { authorizeProjectOwner, isUuid } from "@/lib/engine/data-guard";
import { isAppRole } from "@/lib/engine/data-contract";

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

async function ownerAdmin(projectId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { response: bad("Não autenticado.", 401) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const globalOwner = isOwner({ role: profile?.role, email: user.email });
  const access = await authorizeProjectOwner(supabase, projectId, user.id, globalOwner);
  if (!access.allowed) {
    return { response: bad(access.error ?? "Acesso negado.", access.status ?? 403) };
  }
  const admin = createAdminClient();
  if (!admin) return { response: bad("Backend de autenticação não configurado.", 501) };
  return { admin };
}

/** Lista usuários finais sem expor hashes, tokens ou outros segredos. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return bad("projectId inválido");
  const context = await ownerAdmin(projectId);
  if (context.response) return context.response;

  const { data, error } = await context.admin!
    .from("app_users")
    .select("id, email, name, role, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ users: data ?? [] });
}

/** Altera somente o papel de um usuário pertencente ao projeto atual. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return bad("projectId inválido");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return bad("Corpo inválido");
  }
  const input = body as { id?: unknown; role?: unknown };
  if (typeof input.id !== "string" || !isUuid(input.id)) return bad("Usuário inválido.");
  if (!isAppRole(input.role)) return bad("Papel inválido.");

  const context = await ownerAdmin(projectId);
  if (context.response) return context.response;
  const { data, error } = await context.admin!
    .from("app_users")
    .update({ role: input.role })
    .eq("project_id", projectId)
    .eq("id", input.id)
    .select("id, email, name, role, created_at")
    .maybeSingle();
  if (error) return bad(error.message, 500);
  if (!data) return bad("Usuário não encontrado.", 404);
  return NextResponse.json({ user: data });
}
