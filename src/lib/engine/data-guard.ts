import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { isOwner } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Guarda geral dos endpoints especializados dos apps gerados (upload, e-mail e
 * autenticação). O CRUD de app_data usa a guarda por coleção em
 * collection-access.ts.
 *
 * Regra: a escrita/leitura só é permitida quando
 *   - o projeto está PUBLICADO (endpoints públicos especializados podem operar), OU
 *   - quem chama é o DONO autenticado (preview do editor).
 * Isso fecha o buraco de gravar em qualquer UUID de projeto de terceiros.
 * Combina com um limitador de taxa simples por projeto.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}

export interface GuardResult {
  allowed: boolean;
  status?: number;
  error?: string;
}

/**
 * Guarda estrita para operações do painel que só o dono pode executar.
 *
 * Diferente de authorizeProject(), um projeto publicado não libera acesso aqui:
 * gerar código consome cota e pode gravar imagens/custos, então exige propriedade.
 * A conta owner global mantém o bypass administrativo já usado pelas rotas.
 */
export async function authorizeProjectOwner(
  supabase: SupabaseClient,
  projectId: string,
  userId: string,
  ownerBypass = false
): Promise<GuardResult> {
  if (!isUuid(projectId)) return { allowed: false, status: 400, error: "projectId inválido" };
  if (ownerBypass) return { allowed: true };

  const { data: project, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return { allowed: false, status: 500, error: "Não foi possível validar o projeto." };
  }
  if (!project) {
    return { allowed: false, status: 403, error: "Projeto não pertence a você." };
  }
  return { allowed: true };
}

export async function authorizeProject(
  supabase: SupabaseClient,
  projectId: string,
  op: "read" | "write"
): Promise<GuardResult> {
  if (!isUuid(projectId)) return { allowed: false, status: 400, error: "projectId inválido" };

  const lookup = createAdminClient() ?? supabase;
  const { data: project } = await lookup
    .from("projects")
    .select("user_id, published")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) return { allowed: false, status: 404, error: "Projeto não encontrado" };

  // Projeto publicado: apps públicos podem ler e gravar (ex.: formulários).
  if (project.published) return { allowed: true };

  // Não publicado: só o dono autenticado (preview do editor).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const ownerByAccount = !!user && user.id === project.user_id;
  const ownerByEmail = isOwner({ email: user?.email });
  if (ownerByAccount || ownerByEmail) return { allowed: true };

  return {
    allowed: false,
    status: 403,
    error:
      op === "write"
        ? "Escrita não permitida: publique o projeto para coletar dados, ou faça login como dono."
        : "Leitura não permitida neste projeto não publicado.",
  };
}

/** Limitador de taxa em memória (best-effort) por chave, janela deslizante. */
const hits = new Map<string, number[]>();
export function rateLimit(key: string, max = 60, windowMs = 60_000): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    hits.set(key, arr);
    return false;
  }
  arr.push(now);
  hits.set(key, arr);
  return true;
}

export function requestRateKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || req.headers.get("x-real-ip") || "unknown";
  return crypto.createHash("sha256").update(ip.slice(0, 128)).digest("hex").slice(0, 24);
}

export async function consumeRateLimit(key: string, max = 60, windowMs = 60_000): Promise<boolean> {
  const admin = createAdminClient();
  if (admin) {
    const keyHash = crypto.createHash("sha256").update(key).digest("hex");
    const { data, error } = await admin.rpc("consume_rate_limit", {
      p_key_hash: keyHash,
      p_limit: max,
      p_window_seconds: Math.max(1, Math.ceil(windowMs / 1000)),
    });
    if (!error && typeof data === "boolean") return data;
    if (error) console.warn("[security] rate limit persistente indisponível; usando fallback local", error.message);
  }
  return rateLimit(key, max, windowMs);
}
