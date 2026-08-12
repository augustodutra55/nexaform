import "server-only";
import { createSign } from "node:crypto";

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export function githubAppConfigured(): boolean {
  return Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY);
}

export function createGitHubAppJwt(nowSeconds = Math.floor(Date.now() / 1000)): string {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const rawKey = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !rawKey) throw new Error("GitHub App não configurado no servidor.");

  const privateKey = rawKey.replace(/\\n/g, "\n");
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iat: nowSeconds - 30,
    exp: nowSeconds + 8 * 60,
    iss: appId,
  }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey).toString("base64url")}`;
}

export async function createInstallationToken(installationId: number): Promise<string> {
  if (!Number.isSafeInteger(installationId) || installationId <= 0) throw new Error("Instalação GitHub inválida.");
  const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${createGitHubAppJwt()}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "AD-Studio",
    },
    cache: "no-store",
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || typeof json?.token !== "string") {
    throw new Error(json?.message || `GitHub respondeu HTTP ${response.status}.`);
  }
  return json.token;
}

export async function githubInstallationFetch<T>(installationId: number, path: string, init?: RequestInit): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Caminho GitHub inválido.");
  const token = await createInstallationToken(installationId);
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "AD-Studio",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error((json as any)?.message || `GitHub respondeu HTTP ${response.status}.`);
  return json as T;
}
