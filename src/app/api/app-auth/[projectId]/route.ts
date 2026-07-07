import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeProject, rateLimit, isUuid } from "@/lib/engine/data-guard";

/**
 * Login de usuário final dos apps gerados. Cadastro/entrada por email+senha,
 * escopado por projeto. Senhas com scrypt (sal por usuário); sessão = token
 * aleatório opaco guardado em app_sessions (sem segredo de assinatura).
 * Requer SUPABASE_SERVICE_ROLE_KEY no ambiente (as tabelas são privadas por RLS).
 */

export const runtime = "nodejs";

const SESSION_DAYS = 30;

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}
function hashPassword(password: string, salt: string) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}
function verifyPassword(password: string, salt: string, expected: string) {
  const got = hashPassword(password, salt);
  const a = Buffer.from(got, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function publicUser(u: any) {
  return { id: u.id, email: u.email, name: u.name ?? null };
}

async function newSession(admin: any, projectId: string, userId: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await admin.from("app_sessions").insert({ token, project_id: projectId, user_id: userId, expires_at: expires });
  return token;
}

/** GET ?me=1 com Authorization: Bearer <token> → usuário atual. */
export async function GET(req: NextRequest, { params }: { params: { projectId: string } }) {
  const projectId = params.projectId;
  if (!isUuid(projectId)) return bad("projectId inválido");
  const admin = createAdminClient();
  if (!admin) return bad("Autenticação não configurada (defina SUPABASE_SERVICE_ROLE_KEY).", 501);

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ user: null });

  const { data: session } = await admin
    .from("app_sessions")
    .select("user_id, expires_at")
    .eq("token", token)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!session || new Date(session.expires_at) < new Date()) return NextResponse.json({ user: null });

  const { data: user } = await admin.from("app_users").select("id, email, name").eq("id", session.user_id).maybeSingle();
  return NextResponse.json({ user: user ? publicUser(user) : null });
}

export async function POST(req: NextRequest, { params }: { params: { projectId: string } }) {
  const projectId = params.projectId;
  if (!isUuid(projectId)) return bad("projectId inválido");
  if (!rateLimit(`auth:${projectId}`, 30)) return bad("Muitas tentativas. Aguarde.", 429);

  const admin = createAdminClient();
  if (!admin) return bad("Autenticação não configurada (defina SUPABASE_SERVICE_ROLE_KEY na Vercel).", 501);

  // Só apps publicados (ou o dono no preview) podem ter login de usuário.
  const guard = await authorizeProject(createClient(), projectId, "write");
  if (!guard.allowed) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Corpo inválido");
  }
  const action = String(body?.action || "");

  if (action === "logout") {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (token) await admin.from("app_sessions").delete().eq("token", token).eq("project_id", projectId);
    return NextResponse.json({ ok: true });
  }

  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad("Email inválido");
  if (password.length < 6) return bad("Senha deve ter ao menos 6 caracteres");

  if (action === "signup") {
    const name = body?.name ? String(body.name).slice(0, 120) : null;
    const salt = crypto.randomBytes(16).toString("hex");
    const pass_hash = hashPassword(password, salt);
    const { data: user, error } = await admin
      .from("app_users")
      .insert({ project_id: projectId, email, name, pass_hash, pass_salt: salt })
      .select("id, email, name")
      .single();
    if (error) {
      if (/duplicate|unique/i.test(error.message)) return bad("Este email já está cadastrado", 409);
      return bad(error.message, 500);
    }
    const token = await newSession(admin, projectId, user.id);
    return NextResponse.json({ token, user: publicUser(user) });
  }

  if (action === "login") {
    const { data: user } = await admin
      .from("app_users")
      .select("id, email, name, pass_hash, pass_salt")
      .eq("project_id", projectId)
      .eq("email", email)
      .maybeSingle();
    if (!user || !verifyPassword(password, user.pass_salt, user.pass_hash)) return bad("Email ou senha incorretos", 401);
    const token = await newSession(admin, projectId, user.id);
    return NextResponse.json({ token, user: publicUser(user) });
  }

  return bad("Ação inválida (use signup, login ou logout)");
}
