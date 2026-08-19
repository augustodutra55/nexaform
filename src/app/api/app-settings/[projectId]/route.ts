import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOwner } from "@/lib/access";
import { authorizeProjectOwner, isUuid, consumeRateLimit, requestRateKey } from "@/lib/engine/data-guard";

/**
 * Configurações de CONTEÚDO do site (admin no motor) — textos, cores, imagens e
 * marcas que o DONO do negócio (ex.: a dona da esmalteria) pode editar no próprio
 * site publicado, sem tocar no código. É o equivalente do Nano Banana para dados:
 * um primitivo do motor, igual para TODOS os projetos do AD Studio.
 *
 * Armazenamento: reaproveita a tabela genérica `app_data` numa coleção reservada
 * "__ad_settings" (uma linha por projeto), acessada pelo client admin — então não
 * exige migração nem configuração de permissões de coleção.
 *
 * GET  (público)      → { values }               // só os valores, nunca o PIN
 * POST (dono OU PIN)  → grava { values } e, opcionalmente, define/gira o PIN
 */
export const runtime = "nodejs";
export const maxDuration = 20;

const COLLECTION = "__ad_settings";
const MAX_KEYS = 200;
const MAX_VALUE = 20_000; // por valor (uma imagem em data: URL não entra aqui; usa-se URL pública)
const MAX_TOTAL = 200_000; // teto total do blob serializado

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

function hashPin(pin: string): string {
  return createHash("sha256").update(`adstudio:pin:${pin}`).digest("hex");
}

function pinMatches(stored: string | null | undefined, candidate: string): boolean {
  if (!stored || !candidate) return false;
  const a = Buffer.from(stored);
  const b = Buffer.from(hashPin(candidate));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Aceita só valores simples e curtos (string/number/boolean). Sem objetos aninhados. */
function sanitizeValues(input: any): Record<string, string | number | boolean> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const out: Record<string, string | number | boolean> = {};
  let total = 0;
  let count = 0;
  for (const rawKey of Object.keys(input)) {
    if (count >= MAX_KEYS) break;
    const key = String(rawKey).slice(0, 120);
    if (!/^[a-zA-Z0-9_.:-]+$/.test(key)) continue; // chaves seguras
    if (key.startsWith("__")) continue; // reservado (pinHash etc.)
    const v = input[rawKey];
    let value: string | number | boolean;
    if (typeof v === "number" && Number.isFinite(v)) value = v;
    else if (typeof v === "boolean") value = v;
    else if (typeof v === "string") value = v.slice(0, MAX_VALUE);
    else continue;
    total += key.length + String(value).length;
    if (total > MAX_TOTAL) break;
    out[key] = value;
    count += 1;
  }
  return out;
}

async function readRow(admin: any, projectId: string) {
  const { data } = await admin
    .from("app_data")
    .select("id, data")
    .eq("project_id", projectId)
    .eq("collection", COLLECTION)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data || null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return bad("projectId inválido.");
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ values: {} });
  try {
    const row = await readRow(admin, projectId);
    const values = row?.data?.values && typeof row.data.values === "object" ? row.data.values : {};
    const hasPin = !!row?.data?.pinHash;
    return NextResponse.json({ values, hasPin });
  } catch {
    return NextResponse.json({ values: {} });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return bad("projectId inválido.");

  if (!(await consumeRateLimit(`app-settings:${projectId}:${requestRateKey(req)}`, 40, 10 * 60_000))) {
    return bad("Muitas alterações em pouco tempo. Aguarde um instante.", 429);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Corpo inválido.");
  }

  const admin = createAdminClient();
  if (!admin) return bad("Armazenamento indisponível.", 503);

  // ── Autorização: dono do projeto (sessão) OU PIN de administração do site ──
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let authorizedAsOwner = false;
  if (user) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    const access = await authorizeProjectOwner(
      supabase,
      projectId,
      user.id,
      isOwner({ role: profile?.role, email: user.email })
    );
    authorizedAsOwner = access.allowed;
  }

  const existing = await readRow(admin, projectId);
  const storedPinHash: string | null = existing?.data?.pinHash ?? null;
  const submittedPin = typeof body?.adminPin === "string" ? body.adminPin : "";
  const authorizedByPin = pinMatches(storedPinHash, submittedPin);

  if (!authorizedAsOwner && !authorizedByPin) {
    return bad(storedPinHash ? "PIN de administração incorreto." : "Acesso negado.", 403);
  }

  const values = sanitizeValues(body?.values);
  if (!values) return bad("Valores inválidos.");

  // Só o DONO pode definir/remover o PIN (o buyer com PIN edita conteúdo, não gira o PIN).
  let pinHash = storedPinHash;
  if (authorizedAsOwner && typeof body?.setPin === "string") {
    const pin = body.setPin.trim();
    if (pin === "") pinHash = null; // remover PIN
    else if (/^[0-9]{4,12}$/.test(pin)) pinHash = hashPin(pin);
    else return bad("O PIN deve ter de 4 a 12 dígitos.");
  }

  const payload = { values, pinHash, updatedAt: new Date().toISOString() };
  try {
    if (existing?.id) {
      const { error } = await admin.from("app_data").update({ data: payload }).eq("id", existing.id);
      if (error) return bad("Não foi possível salvar as configurações.", 500);
    } else {
      const { error } = await admin
        .from("app_data")
        .insert({ project_id: projectId, collection: COLLECTION, data: payload });
      if (error) return bad("Não foi possível salvar as configurações.", 500);
    }
  } catch {
    return bad("Não foi possível salvar as configurações.", 500);
  }

  return NextResponse.json({ ok: true, values, hasPin: !!pinHash });
}
