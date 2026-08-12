export interface CustomDomainSnapshot {
  name: string;
  verified: boolean;
  configured: boolean;
  verification?: Array<{ type?: string; domain?: string; value?: string; reason?: string }>;
  updatedAt: string;
}

export interface VercelDomainConfig {
  token: string;
  projectId: string;
  teamId?: string;
}

type DomainEnv = Record<string, string | undefined>;

const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeCustomDomain(input: string): string {
  const value = input.trim().toLowerCase().replace(/\.$/, "");
  if (!value || value.includes("://") || /[/?#@]/.test(value) || value.startsWith("*.")) {
    throw new Error("Informe somente o domínio, sem protocolo, caminho, credenciais ou curinga.");
  }
  if (!DOMAIN_RE.test(value) || value === "localhost" || value.endsWith(".localhost")) {
    throw new Error("Domínio inválido.");
  }
  return value;
}

export function vercelDomainConfigFromEnv(env: DomainEnv = process.env): VercelDomainConfig | null {
  const token = env.VERCEL_TOKEN?.trim();
  const projectId = (env.VERCEL_PROJECT_ID || env.VERCEL_PROJECT_NAME)?.trim();
  const teamId = env.VERCEL_TEAM_ID?.trim();
  if (!token || !projectId) return null;
  return { token, projectId, teamId: teamId || undefined };
}

export function vercelProjectDomainUrl(
  config: VercelDomainConfig,
  domain?: string,
  action?: "verify"
): string {
  const base = `https://api.vercel.com/v9/projects/${encodeURIComponent(config.projectId)}/domains`;
  const suffix = domain ? `/${encodeURIComponent(domain)}${action === "verify" ? "/verify" : ""}` : "";
  const url = new URL(base + suffix);
  if (config.teamId) url.searchParams.set("teamId", config.teamId);
  return url.toString();
}

export function vercelAddProjectDomainUrl(config: VercelDomainConfig): string {
  const url = new URL(`https://api.vercel.com/v10/projects/${encodeURIComponent(config.projectId)}/domains`);
  if (config.teamId) url.searchParams.set("teamId", config.teamId);
  return url.toString();
}

export async function vercelDomainRequest(
  config: VercelDomainConfig,
  url: string,
  init: RequestInit = {}
): Promise<any> {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `Vercel respondeu HTTP ${response.status}.`;
    const error = new Error(message) as Error & { status?: number; code?: string };
    error.status = response.status;
    error.code = payload?.error?.code;
    throw error;
  }
  return payload;
}

export function snapshotFromVercelDomain(payload: any, fallbackDomain: string): CustomDomainSnapshot {
  const verification = Array.isArray(payload?.verification)
    ? payload.verification.map((item: any) => ({
        type: typeof item?.type === "string" ? item.type : undefined,
        domain: typeof item?.domain === "string" ? item.domain : undefined,
        value: typeof item?.value === "string" ? item.value : undefined,
        reason: typeof item?.reason === "string" ? item.reason : undefined,
      }))
    : undefined;
  return {
    name: typeof payload?.name === "string" ? payload.name : fallbackDomain,
    verified: payload?.verified === true,
    configured: payload?.misconfigured !== true,
    verification,
    updatedAt: new Date().toISOString(),
  };
}
