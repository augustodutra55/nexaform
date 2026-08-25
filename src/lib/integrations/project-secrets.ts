import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ProjectIntegrationProvider = "stripe" | "resend" | "automation";
export type ProjectIntegrationConfig =
  | { provider: "stripe"; secretKey: string }
  | { provider: "resend"; apiKey: string; from?: string }
  | { provider: "automation"; targets: string[] };

export interface ProjectIntegrationStatus {
  id: ProjectIntegrationProvider;
  configured: boolean;
  source: "project" | "platform" | "none";
  hint?: string;
  updatedAt?: string;
}

const PROVIDERS: ProjectIntegrationProvider[] = ["stripe", "resend", "automation"];

function encryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const material = env.PROJECT_SECRETS_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!material || material.length < 24) throw new Error("Cofre de integrações não configurado.");
  return createHash("sha256").update("adstudio:project-secrets:v1\0").update(material).digest();
}

function aad(projectId: string, provider: ProjectIntegrationProvider): Buffer {
  return Buffer.from(`adstudio:${projectId}:${provider}:v1`, "utf8");
}

export function encryptProjectIntegration(
  projectId: string,
  config: ProjectIntegrationConfig,
  env: NodeJS.ProcessEnv = process.env
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(env), iv);
  cipher.setAAD(aad(projectId, config.provider));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(config), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptProjectIntegration(
  projectId: string,
  provider: ProjectIntegrationProvider,
  envelope: string,
  env: NodeJS.ProcessEnv = process.env
): ProjectIntegrationConfig {
  const [version, ivRaw, tagRaw, encryptedRaw] = envelope.split(".");
  if (version !== "v1" || !ivRaw || !tagRaw || !encryptedRaw) throw new Error("Segredo armazenado inválido.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(env), Buffer.from(ivRaw, "base64url"));
  decipher.setAAD(aad(projectId, provider));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  const plain = Buffer.concat([decipher.update(Buffer.from(encryptedRaw, "base64url")), decipher.final()]).toString("utf8");
  return validateProjectIntegration(provider, JSON.parse(plain));
}

function safeHttps(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("Webhook inválido.");
  const url = new URL(raw.trim());
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Webhook deve usar HTTPS.");
  return url.toString();
}

export function validateProjectIntegration(provider: ProjectIntegrationProvider, raw: any): ProjectIntegrationConfig {
  if (!PROVIDERS.includes(provider)) throw new Error("Provedor inválido.");
  if (provider === "stripe") {
    const secretKey = String(raw?.secretKey || "").trim();
    if (!/^sk_(?:test|live)_[A-Za-z0-9_]{12,}$/.test(secretKey)) throw new Error("Chave secreta Stripe inválida.");
    return { provider, secretKey };
  }
  if (provider === "resend") {
    const apiKey = String(raw?.apiKey || "").trim();
    const from = typeof raw?.from === "string" ? raw.from.trim().slice(0, 200) : "";
    if (!/^re_[A-Za-z0-9_-]{12,}$/.test(apiKey)) throw new Error("Chave Resend inválida.");
    if (from && !/(?:^|<)[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>?$/.test(from)) throw new Error("Remetente Resend inválido.");
    return { provider, apiKey, from: from || undefined };
  }
  const targets: string[] = Array.isArray(raw?.targets)
    ? Array.from(new Set<string>(raw.targets.slice(0, 20).map((item: unknown) => safeHttps(item))))
    : [];
  if (!targets.length) throw new Error("Informe ao menos um webhook HTTPS.");
  return { provider, targets };
}

function hintFor(config: ProjectIntegrationConfig): string {
  if (config.provider === "automation") return `${config.targets.length} endpoint(s)`;
  const secret = config.provider === "stripe" ? config.secretKey : config.apiKey;
  return `••••${secret.slice(-4)}`;
}

export async function saveProjectIntegration(admin: SupabaseClient, projectId: string, provider: ProjectIntegrationProvider, raw: unknown) {
  const config = validateProjectIntegration(provider, raw);
  const updatedAt = new Date().toISOString();
  const { error } = await admin.from("project_integration_secrets").upsert({
    project_id: projectId,
    provider,
    encrypted_config: encryptProjectIntegration(projectId, config),
    hint: hintFor(config),
    updated_at: updatedAt,
  }, { onConflict: "project_id,provider" });
  if (error) throw new Error(error.message);
  return { id: provider, configured: true, source: "project" as const, hint: hintFor(config), updatedAt };
}

export async function removeProjectIntegration(admin: SupabaseClient, projectId: string, provider: ProjectIntegrationProvider) {
  const { error } = await admin.from("project_integration_secrets").delete().eq("project_id", projectId).eq("provider", provider);
  if (error) throw new Error(error.message);
}

export async function getProjectIntegration<T extends ProjectIntegrationConfig>(
  admin: SupabaseClient,
  projectId: string,
  provider: T["provider"]
): Promise<T | null> {
  const { data, error } = await admin.from("project_integration_secrets")
    .select("encrypted_config")
    .eq("project_id", projectId)
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.encrypted_config ? decryptProjectIntegration(projectId, provider, data.encrypted_config) as T : null;
}

export async function projectIntegrationStatuses(admin: SupabaseClient, projectId: string, env: NodeJS.ProcessEnv = process.env): Promise<ProjectIntegrationStatus[]> {
  const { data, error } = await admin.from("project_integration_secrets")
    .select("provider,hint,updated_at")
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
  const rows = new Map((data || []).map((row: any) => [row.provider, row]));
  const platform = {
    stripe: !!env.STRIPE_SECRET_KEY?.trim(),
    resend: !!env.RESEND_API_KEY?.trim(),
    automation: !!env.AUTOMATION_WEBHOOK_ALLOWLIST?.trim(),
  };
  return PROVIDERS.map((id) => {
    const row: any = rows.get(id);
    return row
      ? { id, configured: true, source: "project", hint: row.hint, updatedAt: row.updated_at }
      : { id, configured: platform[id], source: platform[id] ? "platform" : "none" };
  });
}
