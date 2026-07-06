"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { AppSchema, GenerationResult, isValidSchema } from "@/lib/engine/types";
import { AppCode, AppGenerationResult, EngineMode, isAppCode } from "@/lib/engine/app-types";
import { useProjectStore } from "@/lib/store/project";
import { resolvePlan, isOwner, type AccessProfile } from "@/lib/access";
import { ProjectMeta, readMeta } from "@/lib/studio";
import { ChatPanel, ProjectMode } from "@/components/project/chat-panel";
import { EditorPanel } from "@/components/project/editor-panel";
import { ProjectTopbar, VersionRow } from "@/components/project/project-topbar";
import { PreviewPane } from "@/components/preview/preview-pane";
import { AppRunner } from "@/components/preview/app-runner";
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
  const [appVer, setAppVer] = useState(0);
  const [engineMode, setEngineMode] = useState<EngineMode | null>(null);
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
        setAppCode(proj.schema.code);
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
      setAppCode(result.app.code);
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
    const payload = mode === "app" ? { kind: "app", name: project?.name, code: appCode } : store.schema;
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
    const hasContent = mode === "app" ? !!appCode : !!store.schema;
    if (!hasContent) {
      toast.error("Nada para publicar ainda", { description: "Gere a primeira versão pelo chat." });
      return null;
    }
    const slug = project.share_slug ?? nanoid(10);
    const payload = mode === "app" ? { kind: "app", name: project.name, description: "", code: appCode } : store.schema;
    const { error } = await supabase.from("projects").update({ published: true, share_slug: slug, schema: payload }).eq("id", project.id);
    if (error) {
      toast.error("Não foi possível publicar");
      return null;
    }
    setProject({ ...project, published: true, share_slug: slug });
    return slug;
  }

  function handleExport() {
    const plan = resolvePlan(access);
    if (!plan.canExport) {
      toast.error("Exportação disponível no plano Pro", {
        description: "Faça upgrade para baixar o projeto.",
        action: { label: "Ver planos", onClick: () => router.push("/pricing") },
      });
      return;
    }
    const content = mode === "app" ? appCode ?? "" : JSON.stringify(store.schema, null, 2);
    if (!content) {
      toast.error("Nada para exportar ainda");
      return;
    }
    const blob = new Blob([content], { type: mode === "app" ? "text/plain" : "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = mode === "app" ? `${project?.name ?? "app"}.jsx` : `${project?.name ?? "projeto"}.adstudio.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exportado");
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
      setAppCode(v.schema.code);
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
            <AppRunner code={appCode ?? ""} version={appVer} engineMode={engineMode} onError={handleAppError} />
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
