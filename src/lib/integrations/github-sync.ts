export type GitHubSyncDirection = "push" | "pull";
export type GitHubSyncStatus = "idle" | "syncing" | "synced" | "conflict" | "error";

export interface ProjectGitHubConnection {
  installationId: number;
  owner: string;
  repo: string;
  branch: string;
  rootPath: string;
  lastLocalFingerprint?: string;
  lastRemoteSha?: string;
  lastSyncedAt?: string;
  status?: GitHubSyncStatus;
}

export interface GitHubSyncSnapshot {
  direction: GitHubSyncDirection;
  status: GitHubSyncStatus;
  remoteSha?: string;
  localFingerprint?: string;
  changedFiles?: string[];
  message?: string;
  syncedAt: string;
}

const SEGMENT = /^[A-Za-z0-9._-]+$/;

export function normalizeRepository(input: string): { owner: string; repo: string } | null {
  const value = input.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/^git@github\.com:/i, "").replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
  const parts = value.split("/");
  if (parts.length !== 2 || !SEGMENT.test(parts[0]) || !SEGMENT.test(parts[1])) return null;
  return { owner: parts[0], repo: parts[1] };
}

export function normalizeBranch(input: string): string | null {
  const value = input.trim();
  if (!value || value.startsWith("-") || value.endsWith("/") || value.includes("..") || value.includes("//") || value.includes("@{") || /[\s~^:?*[\\]/.test(value)) return null;
  return value;
}

export function normalizeRootPath(input: string): string | null {
  const value = input.trim().replace(/^\/+|\/+$/g, "");
  if (!value) return "";
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || !SEGMENT.test(part))) return null;
  return parts.join("/");
}

export function isSyncableProjectPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) return false;
  const denied = [".env", ".env.local", ".git/", "node_modules/", ".next/", "dist/", "coverage/"];
  return !denied.some((prefix) => normalized === prefix.replace(/\/$/, "") || normalized.startsWith(prefix));
}

export function buildRepositoryWebUrl(connection: Pick<ProjectGitHubConnection, "owner" | "repo">): string {
  return `https://github.com/${connection.owner}/${connection.repo}`;
}

export function hasRemoteConflict(params: { lastRemoteSha?: string; currentRemoteSha?: string; localChanged: boolean }): boolean {
  if (!params.localChanged || !params.lastRemoteSha || !params.currentRemoteSha) return false;
  return params.lastRemoteSha !== params.currentRemoteSha;
}
