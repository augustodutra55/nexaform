import type { SupabaseClient } from "@supabase/supabase-js";
import { isOwner } from "@/lib/access";

/**
 * Guarda de acesso dos endpoints de dados/upload dos apps gerados.
 *
 * Regra: a escrita/leitura só é permitida quando
 *   - o projeto está PUBLICADO (apps públicos podem coletar/mostrar dados), OU
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

export async function authorizeProject(
  supabase: SupabaseClient,
  projectId: string,
  op: "read" | "write"
): Promise<GuardResult> {
  if (!isUuid(projectId)) return { allowed: false, status: 400, error: "projectId inválido" };

  const { data: project } = await supabase
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
