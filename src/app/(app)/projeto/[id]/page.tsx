"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { AppSchema, GenerationResult, isValidSchema } from "@/lib/engine/types";
import { AppCode, AppFile, AppGenerationResult, EngineMode, isAppCode, isMultiFile } from "@/lib/engine/app-types";
import { useProjectStore } from "@/lib/store/project";
import { resolvePlan, isOwner, type AccessProfile } from "@/lib/access";
import { ProjectMeta, readMeta } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { ChatPanel, ProjectMode } from "@/components/project/chat-panel";
import { CodePanel } from "@/components/project/code-panel";
import { DataPanel } from "@/components/project/data-panel";
import { EditorPanel } from "@/components/project/editor-panel";
import { ProjectTopbar, VersionRow } from "@/components/project/project-topbar";
import { PreviewPane } from "@/components/preview/preview-pane";
import { AppRunner } from "@/components/preview/app-runner";
import { bundleApp } from "@/lib/preview/bundler";
import { Skeleton } from "@/components/ui/skeleton";

interface ProjectRow {
  id: string;
  name: string;
  schema: any;
  published: boolean;
  share_slug: string | null;
  meta: any;
}

export default function ProjectPage({ params }: { params: { id: string } }) {
  const projectId = params.id;
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const store = useProjectStore();
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<{ id: string; role: "user" | "assistant"; content: string }[]>([]);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [access, setAccess] = useState<AccessProfile>({});
  const [generating, setGenerating] = useState(false);
  const [editorOpen, setEditorOpen] = useState(true);
  const [starter, setStarter] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Modo do projeto: site (schema) | app (código) | empty
  const [mode, setMode] = useState<ProjectMode>("empty");
  const [appCode, setAppCode] = useState<string | null>(null);
  const [appFiles, setAppFiles] = useState<AppFile[] | null>(null);
  const [appEntry, setAppEntry] = useState<string | null>(null);
  const [appName, setAppName] = useState<string>("App");
  const [appVer, setAppVer] = useState(0);
  const [engineMode, setEngineMode] = useState<EngineMode | null>(null);
  const [appView, setAppView] = useState<"preview" | "code" | "data">("preview");

  // AppCode atual (multi-arquivo ou single-file legado) para salvar/publicar/exportar.
  const currentApp = useCallback(
    (): AppCode | null => {
      if (appFiles && appFiles.length) {
        return { kind: "app", name: appName, description: "", files: appFiles, entry: appEntry ?? appFiles[0].path };
      }
      if (appCode) return { kind: "app", name: appName, description: "", code: appCode };
      return null;
    },
    [appFiles, appEntry, appCode, appName]
  );
  const [meta, setMeta] = useState<ProjectMeta>({});
  const metaRef = useRef<ProjectMeta>({});
  metaRef.current = meta;
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  // Auto-correção de erros do app
  const [autoFixError, setAutoFixError] = useState<string | null>(null);
  const autoFixCount = useRef(0);

  /* ── Carregamento ─────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: proj, error } = await supabase
        .from("projects")
        .select("id, name, schema, published, share_slug, meta")
        .eq("id", projectId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !proj) {
        setNotFound(true);
        return;
      }
      setProject(proj as ProjectRow);
      setMeta(readMeta(proj.meta));
      store.reset();
      if (isAppCode(proj.schema)) {
        setMode("app");
        setAppName(proj.schema.name ?? "App");
        if (isMultiFile(proj.schema)) {
          setAppFiles(proj.schema.files);
          setAppEntry(proj.schema.entry);
          setAppCode(null);
        } else {
          setAppCode(proj.schema.code ?? null);
          setAppFiles(null);
          setAppEntry(null);
        }
      } else if (isValidSchema(proj.schema)) {
        setMode("site");
        store.setSchema(proj.schema, { recordHistory: false, dirty: false });
      } else {
        setMode("empty");
      }

      let { data: thread } = await supabase.from("chat_threads").select("id").eq("project_id", projectId).maybeSingle();
      if (!thread) {
        const { data: userData } = await supabase.auth.getUser();
        const { data: created } = await supabase
          .from("chat_threads")
          .insert({ project_id: projectId, user_id: userData.user!.id })
          .select("id")
          .single();
        thread = created;
      }
      if (thread) {
        setThreadId(thread.id);
        const { data: msgs } = await supabase
          .from("chat_messages")
          .select("id, role, content")
          .eq("thread_id", thread.id)
          .order("created_at", { ascending: true });
        setMessages((msgs as any) ?? []);
      }

      const { data: vers } = await supabase
        .from("versions")
        .select("id, label, created_at, schema")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      setVersions((vers as any) ?? []);

      const [{ data: sub }, { data: prof }, { data: userData }] = await Promise.all([
        supabase.from("subscriptions").select("plan").maybeSingle(),
        supabase.from("profiles").select("role").maybeSingle(),
        supabase.auth.getUser(),
      ]);
      setAccess({ plan: sub?.plan, role: prof?.role, email: userData.user?.email });

      const s = sessionStorage.getItem(`nexaform:starter:${projectId}`);
      if (s) {
        sessionStorage.removeItem(`nexaform:starter:${projectId}`);
        setStarter(s);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, supabase]);

  /* ── Autosave do modo site ────────────────────────────────── */
  const { schema, saveState } = store;
  useEffect(() => {
    if (mode !== "site" || saveState !== "dirty" || !project) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      store.setSaveState("saving");
      const { error } = await supabase.from("projects").update({ schema, updated_at: new Date().toISOString() }).eq("id", project.id);
      store.setSaveState(error ? "dirty" : "saved");
    }, 1200);
    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, saveState, project?.id, mode]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if (mode !== "site") return;
        e.preventDefault();
        e.shiftKey ? store.redo() : store.undo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  /* ── Resultados ───────────────────────────────────────────── */
  const handleSiteResult = useCallback(
    async (result: GenerationResult) => {
      setMode("site");
      store.setSchema(result.schema);
      const label = result.plan[0] ?? "Geração";
      const { data } = await supabase
        .from("versions")
        .insert({ project_id: projectId, schema: result.schema, label: label.slice(0, 120) })
        .select("id, label, created_at, schema")
        .single();
      if (data) setVersions((v) => [data as any, ...v]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, supabase]
  );

  const handleAppResult = useCallback(
    async (result: AppGenerationResult) => {
      setMode("app");
      setAppName(result.app.name ?? "App");
      if (isMultiFile(result.app)) {
        setAppFiles(result.app.files);
        setAppEntry(result.app.entry);
        setAppCode(null);
      } else {
        setAppCode(result.app.code ?? null);
        setAppFiles(null);
        setAppEntry(null);
      }
      setAppVer((n) => n + 1);
      // salva o AppCode no campo schema (jsonb)
      await supabase.from("projects").update({ schema: result.app, updated_at: new Date().toISOString() }).eq("id", projectId);
      const label = result.plan[0] ?? "Geração de app";
      const { data } = await supabase
        .from("versions")
        .insert({ project_id: projectId, schema: result.app, label: label.slice(0, 120) })
        .select("id, label, created_at, schema")
        .single();
      if (data) setVersions((v) => [data as any, ...v]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, supabase]
  );

  async function handleRename(name: string) {
    if (!project) return;
    setProject({ ...project, name });
    await supabase.from("projects").update({ name }).eq("id", project.id);
    toast.success("Projeto renomeado");
  }

  async function handleMetaChange(patch: Partial<ProjectMeta>) {
    // Merge contra o valor MAIS RECENTE (ref), evitando sobrescrever
    // alterações concorrentes (ex.: input blur + toggle quase juntos).
    const next = { ...metaRef.current, ...patch };
    metaRef.current = next;
    setMeta(next);
    await supabase.from("projects").update({ meta: next, updated_at: new Date().toISOString() }).eq("id", projectId);
  }

  async function handleSaveVersion(label: string) {
    const payload = mode === "app" ? currentApp() : store.schema;
    if (!payload) {
      toast.error("Nada para salvar ainda");
      return;
    }
    const { data } = await supabase
      .from("versions")
      .insert({ project_id: projectId, schema: payload, label: label.slice(0, 120) })
      .select("id, label, created_at, schema")
      .single();
    if (data) setVersions((v) => [data as any, ...v]);
  }

  async function handlePublish(): Promise<string | null> {
    if (!project) return null;
    const appPayload = currentApp();
    const hasContent = mode === "app" ? !!appPayload : !!store.schema;
    if (!hasContent) {
      toast.error("Nada para publicar ainda", { description: "Gere a primeira versão pelo chat." });
      return null;
    }
    const slug = project.share_slug ?? nanoid(10);
    const payload = mode === "app" ? appPayload : store.schema;

    // Build de produção: pré-compila o app AGORA (esbuild-wasm já carregado) e
    // salva o bundle para o site publicado carregar sem Babel/esbuild no visitante.
    // Se falhar, salva null → a página pública cai no runtime completo (fallback).
    let buildBundle: string | null = null;
    if (mode === "app") {
      try {
        const files: AppFile[] =
          appFiles && appFiles.length
            ? appFiles
            : appCode
            ? [{ path: "App.jsx", content: appCode }]
            : [];
        const entry = appEntry ?? files[0]?.path;
        if (files.length && entry) {
          const { code } = await bundleApp(files, entry);
          buildBundle = code;
        }
      } catch {
        buildBundle = null; // fallback seguro
      }
    }

    const { error } = await supabase
      .from("projects")
      .update({ published: true, share_slug: slug, schema: payload, build_bundle: buildBundle })
      .eq("id", project.id);
    if (error) {
      toast.error("Não foi possível publicar");
      return null;
    }
    setProject({ ...project, published: true, share_slug: slug });
    return slug;
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Carrega o JSZip via CDN (sem inflar o bundle) para exportar projeto multi-arquivo. */
  function loadJSZip(): Promise<any> {
    const w = window as any;
    if (w.JSZip) return Promise.resolve(w.JSZip);
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
      s.onload = () => resolve((window as any).JSZip);
      s.onerror = () => reject(new Error("Falha ao carregar o compactador."));
      document.head.appendChild(s);
    });
  }

  async function handleExport() {
    const plan = resolvePlan(access);
    if (!plan.canExport) {
      toast.error("Exportação disponível no plano Pro", {
        description: "Faça upgrade para baixar o projeto.",
        action: { label: "Ver planos", onClick: () => router.push("/pricing") },
      });
      return;
    }
    const safeName = (project?.name ?? "projeto").replace(/[^\w.-]+/g, "-").slice(0, 60) || "projeto";

    // Multi-arquivo real → .zip com a árvore de arquivos + package.json + README.
    if (mode === "app" && appFiles && appFiles.length) {
      try {
        const JSZip = await loadJSZip();
        const zip = new JSZip();
        const root = zip.folder(safeName)!;
        for (const f of appFiles) root.file(f.path, f.content);
        // detecta TODOS os pacotes npm importados para declarar no package.json
        const allSrc = appFiles.map((f) => f.content).join("\n");
        const deps: Record<string, string> = { react: "^18.2.0", "react-dom": "^18.2.0" };
        const importRe = /from\s+['"]([^'".][^'"]*)['"]/g;
        let m: RegExpExecArray | null;
        while ((m = importRe.exec(allSrc))) {
          const spec = m[1];
          if (spec.startsWith("react")) continue;
          // nome do pacote (respeita escopo @org/pkg), ignora subcaminhos
          const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
          if (pkg && !deps[pkg]) deps[pkg] = "latest";
        }
        root.file(
          "package.json",
          JSON.stringify(
            {
              name: safeName.toLowerCase(),
              private: true,
              version: "0.1.0",
              description: `Exportado do AD Studio — entry: ${appEntry ?? appFiles[0].path}`,
              dependencies: deps,
            },
            null,
            2
          )
        );
        root.file(
          "README.md",
          `# ${project?.name ?? "Projeto"}\n\nProjeto React multi-arquivo gerado pelo AD Studio.\n\n- Arquivo de entrada: \`${appEntry ?? appFiles[0].path}\`\n- ${appFiles.length} arquivo(s)\n- Estilização: Tailwind CSS (via CDN no preview)\n`
        );
        const blob = await zip.generateAsync({ type: "blob" });
        downloadBlob(blob, `${safeName}.zip`);
        toast.success("Exportado como .zip (multi-arquivo)");
      } catch (e: any) {
        toast.error("Não foi possível gerar o .zip", { description: e?.message });
      }
      return;
    }

    // Single-file (legado) → .jsx; site → .json.
    const content = mode === "app" ? appCode ?? "" : JSON.stringify(store.schema, null, 2);
    if (!content) {
      toast.error("Nada para exportar ainda");
      return;
    }
    downloadBlob(
      new Blob([content], { type: mode === "app" ? "text/plain" : "application/json" }),
      mode === "app" ? `${safeName}.jsx` : `${safeName}.adstudio.json`
    );
    toast.success("Exportado");
  }

  /** Arquivos para a aba de Código (single-file vira um App.jsx). */
  const codeFiles: AppFile[] =
    appFiles && appFiles.length
      ? appFiles
      : appCode
      ? [{ path: "App.jsx", content: appCode }]
      : [];

  /** Aplica edições manuais de código: persiste e re-executa o preview. */
  async function handleApplyCode(edited: AppFile[]) {
    let app: AppCode;
    if (appFiles && appFiles.length) {
      setAppFiles(edited);
      setAppEntry((e) => (edited.some((f) => f.path === e) ? e : edited[0]?.path ?? null));
      app = { kind: "app", name: appName, description: "", files: edited, entry: appEntry ?? edited[0]?.path };
    } else {
      const code = edited[0]?.content ?? "";
      setAppCode(code);
      app = { kind: "app", name: appName, description: "", code };
    }
    setAppVer((n) => n + 1);
    setAppView("preview");
    await supabase.from("projects").update({ schema: app, updated_at: new Date().toISOString() }).eq("id", projectId);
    toast.success("Código aplicado e executado");
  }

  function handleAppError(message: string) {
    // Máx. 2 correções automáticas por sessão para evitar loop.
    if (autoFixCount.current >= 2) return;
    autoFixCount.current += 1;
    toast.info("Corrigindo o erro automaticamente…", { description: "Reenviando para a IA ajustar o código." });
    setAutoFixError(message);
  }

  function handleRestoreVersion(v: VersionRow) {
    if (isAppCode(v.schema)) {
      setMode("app");
      setAppName(v.schema.name ?? "App");
      if (isMultiFile(v.schema)) {
        setAppFiles(v.schema.files);
        setAppEntry(v.schema.entry);
        setAppCode(null);
      } else {
        setAppCode(v.schema.code ?? null);
        setAppFiles(null);
        setAppEntry(null);
      }
      setAppVer((n) => n + 1);
      supabase.from("projects").update({ schema: v.schema }).eq("id", projectId);
    } else if (isValidSchema(v.schema)) {
      setMode("site");
      store.setSchema(v.schema);
    }
  }

  /* ── Render ───────────────────────────────────────────────── */
  if (notFound) {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center text-center">
        <p className="font-medium">Projeto não encontrado</p>
        <p className="mt-1 text-sm text-muted-foreground">Ele pode ter sido excluído ou você não tem acesso.</p>
      </div>
    );
  }

  if (!project || !threadId) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)]">
        <div className="w-[380px] space-y-3 border-r p-4">
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
        <div className="flex-1 p-6">
          <Skeleton className="h-full w-full rounded-xl" />
        </div>
      </div>
    );
  }

  const showSiteEditor = mode === "site" && editorOpen;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <ProjectTopbar
        name={project.name}
        published={project.published}
        shareSlug={project.share_slug}
        canExport={resolvePlan(access).canExport}
        versions={versions}
        meta={meta}
        studio={isOwner(access)}
        onRename={handleRename}
        onRestoreVersion={handleRestoreVersion}
        onPublish={handlePublish}
        onExport={handleExport}
        onToggleEditor={() => setEditorOpen((o) => !o)}
        onMetaChange={handleMetaChange}
        onSaveVersion={handleSaveVersion}
      />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[340px] shrink-0 flex-col border-r xl:w-[380px]">
          <ChatPanel
            projectId={projectId}
            threadId={threadId}
            initialMessages={messages}
            mode={mode}
            schema={store.schema}
            code={appCode}
            files={appFiles}
            projectName={project.name}
            starterPrompt={starter}
            autoFixError={autoFixError}
            onAutoFixHandled={() => setAutoFixError(null)}
            onSiteResult={handleSiteResult}
            onAppResult={handleAppResult}
            onGeneratingChange={setGenerating}
            onEngineMode={setEngineMode}
          />
        </aside>

        <div className="min-w-0 flex-1">
          {mode === "app" ? (
            <div className="flex h-full flex-col">
              <div className="flex items-center gap-1 border-b px-3 py-1.5">
                <div className="inline-flex rounded-lg border p-0.5 text-xs">
                  <button
                    onClick={() => setAppView("preview")}
                    className={cn(
                      "rounded-md px-2.5 py-1 font-medium transition-colors",
                      appView === "preview" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Preview
                  </button>
                  <button
                    onClick={() => setAppView("code")}
                    className={cn(
                      "rounded-md px-2.5 py-1 font-medium transition-colors",
                      appView === "code" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Código{codeFiles.length > 1 ? ` · ${codeFiles.length}` : ""}
                  </button>
                  <button
                    onClick={() => setAppView("data")}
                    title="Gerencie os dados do app (produtos, cadastros…) — o app lê via AD.list"
                    className={cn(
                      "rounded-md px-2.5 py-1 font-medium transition-colors",
                      appView === "data" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Dados
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1">
                {appView === "data" ? (
                  <DataPanel projectId={projectId} />
                ) : appView === "code" && codeFiles.length ? (
                  <CodePanel files={codeFiles} entry={appEntry} onApply={handleApplyCode} />
                ) : (
                  <AppRunner
                    code={appCode ?? ""}
                    files={appFiles}
                    entry={appEntry}
                    version={appVer}
                    engineMode={engineMode}
                    projectId={projectId}
                    onError={handleAppError}
                  />
                )}
              </div>
            </div>
          ) : (
            <PreviewPane
              schema={store.schema}
              currentPageId={store.currentPageId}
              onNavigate={store.setCurrentPage}
              selectedSectionId={store.selectedSectionId}
              onSelectSection={store.selectSection}
              generating={generating}
            />
          )}
        </div>

        {showSiteEditor && (
          <aside className="hidden w-[300px] shrink-0 border-l lg:block">
            <EditorPanel />
          </aside>
        )}
      </div>
    </div>
  );
}
