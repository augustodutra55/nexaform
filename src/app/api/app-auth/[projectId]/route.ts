import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeProject, consumeRateLimit, isUuid, requestRateKey } from "@/lib/engine/data-guard";

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
function hashPassword(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key.toString("hex")));
  });
}
async function verifyPassword(password: string, salt: string, expected: string) {
  const got = await hashPassword(password, salt);
  const a = Buffer.from(got, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function publicUser(u: any) {
  return { id: u.id, email: u.email, name: u.name ?? null };
}

async function newSession(admin: any, projectId: string, userId: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const stored = crypto.createHash("sha256").update(token).digest("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  const { error } = await admin.from("app_sessions").insert({ token: stored, token_hashed: true, project_id: projectId, user_id: userId, expires_at: expires });
  if (error) throw new Error("Não foi possível criar a sessão.");
  return token;
}

function storedToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** GET ?me=1 com Authorization: Bearer <token> → usuário atual. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return bad("projectId inválido");
  const admin = createAdminClient();
  if (!admin) return bad("Autenticação não configurada (defina SUPABASE_SERVICE_ROLE_KEY).", 501);

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ user: null });

  const { data: session } = await admin
    .from("app_sessions")
    .select("user_id, expires_at")
    .eq("token", storedToken(token))
    .eq("token_hashed", true)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!session || new Date(session.expires_at) < new Date()) return NextResponse.json({ user: null });

  const { data: user } = await admin.from("app_users").select("id, email, name").eq("id", session.user_id).maybeSingle();
  return NextResponse.json({ user: user ? publicUser(user) : null });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return bad("projectId inválido");
  if (!(await consumeRateLimit(`auth:${projectId}:${requestRateKey(req)}`, 20, 10 * 60_000))) return bad("Muitas tentativas. Aguarde.", 429);

  const admin = createAdminClient();
  if (!admin) return bad("Autenticação não configurada (defina SUPABASE_SERVICE_ROLE_KEY na Vercel).", 501);

  // Só apps publicados (ou o dono no preview) podem ter login de usuário.
  const guard = await authorizeProject(await createClient(), projectId, "write");
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
    if (token) await admin.from("app_sessions").delete().eq("token", storedToken(token)).eq("token_hashed", true).eq("project_id", projectId);
    return NextResponse.json({ ok: true });
  }

  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad("Email inválido");
  if (!password) return bad("Senha obrigatória");

  if (action === "signup") {
    if (password.length < 8) return bad("Senha deve ter ao menos 8 caracteres");
    const name = body?.name ? String(body.name).slice(0, 120) : null;
    const salt = crypto.randomBytes(16).toString("hex");
    const pass_hash = await hashPassword(password, salt);
    const { data: user, error } = await admin
      .from("app_users")
      .insert({ project_id: projectId, email, name, pass_hash, pass_salt: salt })
      .select("id, email, name")
      .single();
    if (error) {
      if (/duplicate|unique/i.test(error.message)) return bad("Não foi possível criar a conta. Se você já possui cadastro, entre normalmente.", 409);
      return bad(error.message, 500);
    }
    let token: string;
    try { token = await newSession(admin, projectId, user.id); }
    catch { return bad("Conta criada, mas não foi possível iniciar a sessão. Tente entrar novamente.", 500); }
    return NextResponse.json({ token, user: publicUser(user) });
  }

  if (action === "login") {
    const { data: user } = await admin
      .from("app_users")
      .select("id, email, name, pass_hash, pass_salt")
      .eq("project_id", projectId)
      .eq("email", email)
      .maybeSingle();
    if (!user || !(await verifyPassword(password, user.pass_salt, user.pass_hash))) return bad("Email ou senha incorretos", 401);
    let token: string;
    try { token = await newSession(admin, projectId, user.id); }
    catch { return bad("Não foi possível iniciar a sessão. Tente novamente.", 500); }
    return NextResponse.json({ token, user: publicUser(user) });
  }

  return bad("Ação inválida (use signup, login ou logout)");
}
