"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { AppSchema, GenerationResult, isValidSchema } from "@/lib/engine/types";
import { useProjectStore } from "@/lib/store/project";
import { resolvePlan, type AccessProfile } from "@/lib/access";
import { ChatPanel } from "@/components/project/chat-panel";
import { EditorPanel } from "@/components/project/editor-panel";
import { ProjectTopbar, VersionRow } from "@/components/project/project-topbar";
import { PreviewPane } from "@/components/preview/preview-pane";
import { Skeleton } from "@/components/ui/skeleton";

interface ProjectRow {
  id: string;
  name: string;
  schema: AppSchema | null;
  published: boolean;
  share_slug: string | null;
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
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  /* ── Carregamento inicial ─────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: proj, error } = await supabase
        .from("projects")
        .select("id, name, schema, published, share_slug")
        .eq("id", projectId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !proj) {
        setNotFound(true);
        return;
      }
      setProject(proj as ProjectRow);
      store.reset();
      if (isValidSchema(proj.schema)) {
        store.setSchema(proj.schema, { recordHistory: false, dirty: false });
      }

      // thread de chat (cria se não existir)
      let { data: thread } = await supabase
        .from("chat_threads")
        .select("id")
        .eq("project_id", projectId)
        .maybeSingle();
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

  /* ── Autosave (debounce) ──────────────────────────────────── */
  const { schema, saveState } = store;
  useEffect(() => {
    if (saveState !== "dirty" || !project) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      store.setSaveState("saving");
      const { error } = await supabase
        .from("projects")
        .update({ schema, updated_at: new Date().toISOString() })
        .eq("id", project.id);
      store.setSaveState(error ? "dirty" : "saved");
      if (error) toast.error("Falha ao salvar automaticamente", { description: "Vamos tentar de novo." });
    }, 1200);
    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, saveState, project?.id]);

  /* ── Atalhos de teclado ───────────────────────────────────── */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? store.redo() : store.undo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Handlers ─────────────────────────────────────────────── */
  const handleResult = useCallback(
    async (result: GenerationResult) => {
      store.setSchema(result.schema);
      // registra versão
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

  async function handleRename(name: string) {
    if (!project) return;
    setProject({ ...project, name });
    await supabase.from("projects").update({ name }).eq("id", project.id);
    toast.success("Projeto renomeado");
  }

  async function handlePublish(): Promise<string | null> {
    if (!project) return null;
    if (!store.schema) {
      toast.error("Nada para publicar ainda", { description: "Gere a primeira versão pelo chat." });
      return null;
    }
    const slug = project.share_slug ?? nanoid(10);
    const { error } = await supabase
      .from("projects")
      .update({ published: true, share_slug: slug, schema: store.schema })
      .eq("id", project.id);
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
        description: "Faça upgrade para baixar o projeto completo.",
        action: { label: "Ver planos", onClick: () => router.push("/pricing") },
      });
      return;
    }
    if (!store.schema) {
      toast.error("Nada para exportar ainda");
      return;
    }
    const blob = new Blob([JSON.stringify(store.schema, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project?.name ?? "projeto"}.nexaform.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Projeto exportado");
  }

  function handleRestoreVersion(v: VersionRow) {
    if (isValidSchema(v.schema)) store.setSchema(v.schema);
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

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <ProjectTopbar
        name={project.name}
        published={project.published}
        shareSlug={project.share_slug}
        canExport={resolvePlan(access).canExport}
        versions={versions}
        onRename={handleRename}
        onRestoreVersion={handleRestoreVersion}
        onPublish={handlePublish}
        onExport={handleExport}
        onToggleEditor={() => setEditorOpen((o) => !o)}
      />
      <div className="flex min-h-0 flex-1">
        {/* Chat */}
        <aside className="flex w-[340px] shrink-0 flex-col border-r xl:w-[380px]">
          <ChatPanel
            projectId={projectId}
            threadId={threadId}
            initialMessages={messages}
            schema={store.schema}
            starterPrompt={starter}
            onResult={handleResult}
            onGeneratingChange={setGenerating}
          />
        </aside>

        {/* Preview */}
        <div className="min-w-0 flex-1">
          <PreviewPane
            schema={store.schema}
            currentPageId={store.currentPageId}
            onNavigate={store.setCurrentPage}
            selectedSectionId={store.selectedSectionId}
            onSelectSection={store.selectSection}
            generating={generating}
          />
        </div>

        {/* Editor complementar */}
        {editorOpen && (
          <aside className="hidden w-[300px] shrink-0 border-l lg:block">
            <EditorPanel />
          </aside>
        )}
      </div>
    </div>
  );
}
