import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/access";
import { authorizeProjectOwner, isUuid } from "@/lib/engine/data-guard";
import { isAppCode, isMultiFile, type AppCode, type AppFile } from "@/lib/engine/app-types";
import { githubAppConfigured, githubInstallationFetch } from "@/lib/integrations/github-app";
import {
  buildRepositoryWebUrl,
  hasRemoteConflict,
  isSyncableProjectPath,
  normalizeBranch,
  normalizeRepository,
  normalizeRootPath,
  type ProjectGitHubConnection,
} from "@/lib/integrations/github-sync";

export const maxDuration = 60;

function jsonError(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

function encodePath(value: string) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function joinRoot(rootPath: string, path: string) {
  return [rootPath, path.replace(/^\/+/, "")].filter(Boolean).join("/");
}

function stripRoot(rootPath: string, path: string) {
  if (!rootPath) return path;
  const prefix = `${rootPath}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : "";
}

function fingerprintFiles(files: AppFile[], entry: string) {
  const normalized = [...files]
    .map((file) => ({ path: file.path.replace(/\\/g, "/").replace(/^\/+/, ""), content: file.content }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return createHash("sha256").update(JSON.stringify({ entry, files: normalized })).digest("hex");
}

function appFiles(app: AppCode): { files: AppFile[]; entry: string } {
  if (isMultiFile(app)) return { files: app.files, entry: app.entry };
  return {
    files: [{ path: "App.jsx", content: app.code || "" }],
    entry: "App.jsx",
  };
}

function sanitizeFiles(files: AppFile[]) {
  const seen = new Set<string>();
  const safe: AppFile[] = [];
  for (const file of files) {
    const path = file.path.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!isSyncableProjectPath(path) || seen.has(path) || typeof file.content !== "string") continue;
    seen.add(path);
    safe.push({ path, content: file.content });
  }
  return safe;
}

function connectionFromRow(row: any): ProjectGitHubConnection | null {
  if (!row) return null;
  return {
    installationId: Number(row.installation_id),
    owner: row.repo_owner,
    repo: row.repo_name,
    branch: row.branch,
    rootPath: row.root_path || "",
    lastRemoteSha: row.last_remote_sha || undefined,
    lastLocalFingerprint: row.last_local_fingerprint || undefined,
    lastSyncedAt: row.last_synced_at || undefined,
    status: row.last_sync_status || "idle",
  };
}

async function resolveContext(projectId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { response: jsonError("Não autenticado.", 401) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const access = await authorizeProjectOwner(
    supabase,
    projectId,
    user.id,
    isOwner({ role: profile?.role, email: user.email })
  );
  if (!access.allowed) return { response: jsonError(access.error || "Acesso negado.", access.status || 403) };
  const { data: project, error } = await supabase.from("projects").select("id,name,schema").eq("id", projectId).maybeSingle();
  if (error) return { response: jsonError(error.message, 500) };
  if (!project || !isAppCode(project.schema)) return { response: jsonError("Este projeto ainda não possui código para sincronizar.", 422) };
  const { data: row } = await supabase.from("project_github_connections").select("*").eq("project_id", projectId).maybeSingle();
  return { supabase, project, connection: connectionFromRow(row) };
}

async function currentRemoteSha(connection: ProjectGitHubConnection) {
  const ref = await githubInstallationFetch<any>(
    connection.installationId,
    `/repos/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.repo)}/git/ref/heads/${encodePath(connection.branch)}`
  );
  const sha = ref?.object?.sha;
  if (typeof sha !== "string" || !sha) throw new Error("Não foi possível identificar o commit remoto da branch.");
  return sha;
}

async function saveConnection(supabase: any, projectId: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from("project_github_connections").update({ ...patch, updated_at: new Date().toISOString() }).eq("project_id", projectId);
  if (error) throw error;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return jsonError("projectId inválido.");
  const resolved = await resolveContext(projectId);
  if (resolved.response) return resolved.response;
  const slug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG?.trim() || "";
  const connection = resolved.connection || null;
  return NextResponse.json({
    configured: githubAppConfigured(),
    appSlug: slug,
    installUrl: slug ? `https://github.com/apps/${encodeURIComponent(slug)}/installations/new` : null,
    connection: connection ? { ...connection, webUrl: buildRepositoryWebUrl(connection) } : null,
  }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) return jsonError("projectId inválido.");
  if (!githubAppConfigured()) return jsonError("GitHub App não configurado no servidor.", 503);
  const resolved = await resolveContext(projectId);
  if (resolved.response) return resolved.response;
  const { supabase, project } = resolved;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError("Corpo inválido.");
  }
  const action = body?.action;

  if (action === "disconnect") {
    const { error } = await supabase!.from("project_github_connections").delete().eq("project_id", projectId);
    if (error) return jsonError(error.message, 500);
    return NextResponse.json({ ok: true });
  }

  if (action === "connect") {
    const installationId = Number(body?.installationId);
    const repository = normalizeRepository(String(body?.repository || ""));
    const branch = normalizeBranch(String(body?.branch || "main"));
    const rootPath = normalizeRootPath(String(body?.rootPath || ""));
    if (!Number.isSafeInteger(installationId) || installationId <= 0) return jsonError("Installation ID inválido.");
    if (!repository) return jsonError("Repositório inválido. Use owner/repo.");
    if (!branch) return jsonError("Branch inválida.");
    if (rootPath === null) return jsonError("Pasta raiz inválida.");
    const candidate: ProjectGitHubConnection = { installationId, owner: repository.owner, repo: repository.repo, branch, rootPath };
    try {
      await githubInstallationFetch<any>(installationId, `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`);
      const remoteSha = await currentRemoteSha(candidate);
      const local = appFiles(project!.schema as AppCode);
      const files = sanitizeFiles(local.files);
      const localFingerprint = fingerprintFiles(files, local.entry);
      const now = new Date().toISOString();
      const { error } = await supabase!.from("project_github_connections").upsert({
        project_id: projectId,
        installation_id: installationId,
        repo_owner: repository.owner,
        repo_name: repository.repo,
        branch,
        root_path: rootPath,
        last_remote_sha: remoteSha,
        last_local_fingerprint: localFingerprint,
        last_sync_status: "idle",
        last_sync_message: "Conexão validada. Escolha enviar ou puxar para iniciar a sincronização.",
        updated_at: now,
      }, { onConflict: "project_id" });
      if (error) throw error;
      return NextResponse.json({ ok: true, remoteSha, webUrl: buildRepositoryWebUrl(candidate) });
    } catch (error: any) {
      return jsonError(error?.message || "Não foi possível validar a instalação GitHub.", 502);
    }
  }

  const connection = resolved.connection;
  if (!connection) return jsonError("Conecte um repositório antes de sincronizar.", 409);

  if (action === "push") {
    try {
      await saveConnection(supabase, projectId, { last_sync_status: "syncing", last_sync_message: "Enviando código para o GitHub…" });
      const local = appFiles(project!.schema as AppCode);
      const files = sanitizeFiles(local.files);
      if (!files.length) throw new Error("Nenhum arquivo seguro disponível para envio.");
      const localFingerprint = fingerprintFiles(files, local.entry);
      const remoteSha = await currentRemoteSha(connection);
      const localChanged = connection.lastLocalFingerprint !== localFingerprint;
      if (!localChanged) {
        await saveConnection(supabase, projectId, { last_sync_status: "synced", last_sync_message: "Nenhuma alteração local para enviar." });
        return NextResponse.json({ ok: true, unchanged: true, remoteSha });
      }
      if (hasRemoteConflict({ lastRemoteSha: connection.lastRemoteSha, currentRemoteSha: remoteSha, localChanged })) {
        await saveConnection(supabase, projectId, { last_sync_status: "conflict", last_sync_message: "GitHub e AD Studio mudaram desde a última sincronização." });
        return jsonError("Conflito detectado: o GitHub e o AD Studio mudaram. Puxe ou revise o remoto antes de enviar.", 409);
      }
      const commit = await githubInstallationFetch<any>(connection.installationId, `/repos/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.repo)}/git/commits/${remoteSha}`);
      const baseTree = commit?.tree?.sha;
      if (typeof baseTree !== "string") throw new Error("Árvore remota inválida.");
      const blobs = await Promise.all(files.map(async (file) => {
        const blob = await githubInstallationFetch<any>(connection.installationId, `/repos/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.repo)}/git/blobs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
        });
        return { path: joinRoot(connection.rootPath, file.path), mode: "100644", type: "blob", sha: blob.sha };
      }));
      const tree = await githubInstallationFetch<any>(connection.installationId, `/repos/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.repo)}/git/trees`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ base_tree: baseTree, tree: blobs }),
      });
      const nextCommit = await githubInstallationFetch<any>(connection.installationId, `/repos/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.repo)}/git/commits`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: `AD Studio: ${project!.name || "atualiza projeto"}`, tree: tree.sha, parents: [remoteSha] }),
      });
      await githubInstallationFetch<any>(connection.installationId, `/repos/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.repo)}/git/refs/heads/${encodePath(connection.branch)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sha: nextCommit.sha, force: false }),
      });
      const now = new Date().toISOString();
      await saveConnection(supabase, projectId, {
        last_remote_sha: nextCommit.sha,
        last_local_fingerprint: localFingerprint,
        last_sync_status: "synced",
        last_sync_message: `${files.length} arquivo(s) enviados ao GitHub.`,
        last_synced_at: now,
      });
      return NextResponse.json({ ok: true, remoteSha: nextCommit.sha, changedFiles: files.map((f) => f.path), syncedAt: now });
    } catch (error: any) {
      await saveConnection(supabase, projectId, { last_sync_status: "error", last_sync_message: error?.message || "Falha ao enviar ao GitHub." }).catch(() => {});
      return jsonError(error?.message || "Falha ao enviar ao GitHub.", 502);
    }
  }

  if (action === "pull") {
    try {
      await saveConnection(supabase, projectId, { last_sync_status: "syncing", last_sync_message: "Lendo código do GitHub…" });
      const current = appFiles(project!.schema as AppCode);
      const currentFiles = sanitizeFiles(current.files);
      const localFingerprint = fingerprintFiles(currentFiles, current.entry);
      const localChanged = connection.lastLocalFingerprint !== localFingerprint;
      const remoteSha = await currentRemoteSha(connection);
      const remoteChanged = connection.lastRemoteSha !== remoteSha;
      if (!remoteChanged) {
        await saveConnection(supabase, projectId, { last_sync_status: "synced", last_sync_message: "GitHub já está na versão conhecida." });
        return NextResponse.json({ ok: true, unchanged: true, remoteSha });
      }
      if (localChanged) {
        await saveConnection(supabase, projectId, { last_sync_status: "conflict", last_sync_message: "Há mudanças locais e remotas desde a última sincronização." });
        return jsonError("Conflito detectado: existem alterações locais ainda não enviadas e alterações novas no GitHub.", 409);
      }
      const commit = await githubInstallationFetch<any>(connection.installationId, `/repos/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.repo)}/git/commits/${remoteSha}`);
      const treeSha = commit?.tree?.sha;
      if (typeof treeSha !== "string") throw new Error("Árvore remota inválida.");
      const tree = await githubInstallationFetch<any>(connection.installationId, `/repos/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.repo)}/git/trees/${treeSha}?recursive=1`);
      const allowedExt = /\.(?:jsx?|tsx?|css|json)$/i;
      const candidates = (Array.isArray(tree?.tree) ? tree.tree : []).filter((item: any) => {
        if (item?.type !== "blob" || typeof item.path !== "string" || typeof item.sha !== "string") return false;
        const relative = stripRoot(connection.rootPath, item.path);
        return Boolean(relative && allowedExt.test(relative) && isSyncableProjectPath(relative) && Number(item.size || 0) <= 500_000);
      }).slice(0, 80);
      if (!candidates.length) throw new Error("Nenhum arquivo de código compatível foi encontrado na pasta configurada.");
      let totalBytes = 0;
      const pulled: AppFile[] = [];
      for (const item of candidates) {
        const blob = await githubInstallationFetch<any>(connection.installationId, `/repos/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.repo)}/git/blobs/${item.sha}`);
        if (blob?.encoding !== "base64" || typeof blob?.content !== "string") continue;
        const content = Buffer.from(blob.content.replace(/\s/g, ""), "base64").toString("utf8");
        totalBytes += Buffer.byteLength(content);
        if (totalBytes > 2_000_000) throw new Error("O código remoto excede o limite seguro de 2 MB para importação.");
        pulled.push({ path: stripRoot(connection.rootPath, item.path), content });
      }
      const files = sanitizeFiles(pulled);
      const preferredEntry = current.entry;
      const entry = files.some((file) => file.path === preferredEntry)
        ? preferredEntry
        : files.find((file) => /(^|\/)App\.(?:tsx|jsx|ts|js)$/i.test(file.path))?.path;
      if (!entry) throw new Error("Não encontrei um arquivo App.jsx/App.tsx de entrada. Ajuste a pasta raiz da conexão.");
      const nextApp: AppCode = {
        ...(project!.schema as AppCode),
        kind: "app",
        files,
        entry,
        code: undefined,
      };
      const nextFingerprint = fingerprintFiles(files, entry);
      const now = new Date().toISOString();
      const { error: versionError } = await supabase!.from("versions").insert({
        project_id: projectId,
        schema: project!.schema,
        label: `Antes do pull GitHub · ${connection.owner}/${connection.repo}`,
      });
      if (versionError) throw versionError;
      const { error: projectError } = await supabase!.from("projects").update({ schema: nextApp, updated_at: now }).eq("id", projectId);
      if (projectError) throw projectError;
      await saveConnection(supabase, projectId, {
        last_remote_sha: remoteSha,
        last_local_fingerprint: nextFingerprint,
        last_sync_status: "synced",
        last_sync_message: `${files.length} arquivo(s) puxados do GitHub.`,
        last_synced_at: now,
      });
      return NextResponse.json({ ok: true, remoteSha, changedFiles: files.map((f) => f.path), syncedAt: now, reload: true });
    } catch (error: any) {
      await saveConnection(supabase, projectId, { last_sync_status: "error", last_sync_message: error?.message || "Falha ao puxar do GitHub." }).catch(() => {});
      return jsonError(error?.message || "Falha ao puxar do GitHub.", 502);
    }
  }

  return jsonError("Ação GitHub inválida.");
}
