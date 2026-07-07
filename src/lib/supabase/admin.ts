import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Client "admin" (service role) — ignora RLS. Usado SOMENTE no servidor, para o
 * login de usuário final dos apps gerados (ler/escrever app_users/app_sessions,
 * que são invisíveis ao papel público). Retorna null se a chave não estiver
 * configurada, para o recurso degradar com mensagem clara em vez de quebrar.
 */
export function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
