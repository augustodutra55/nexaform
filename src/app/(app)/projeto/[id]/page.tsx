"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { AppSchema, GenerationResult, isValidSchema } from "@/lib/engine/types";
import { AppCode, AppFile, AppGenerationResult, EngineMode, isAppCode, isMultiFile } from "@/lib/engine/app-types";
import { useProjectStore } from "@/lib/store/project";
import { resolvePlan, isOwner, type AccessProfile } from "@/lib/access";
import { AcceptanceRepairSnapshot, ProjectMeta, ProjectAcceptanceSnapshot, readMeta } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { ChatPanel, ProjectMode } from "@/components/project/chat-panel";
import { CodePanel } from "@/components/project/code-panel";
import { DataPanel } from "@/components/project/data-panel";
import { MediaPanel } from "@/components/project/media-panel";
import { AcceptancePanel } from "@/components/project/acceptance-panel";
import { EditorPanel } from "@/components/project/editor-panel";
import { ProjectTopbar, VersionRow } from "@/components/project/project-topbar";
import { PreviewPane } from "@/components/preview/preview-pane";
import { AppRunner } from "@/components/preview/app-runner";
import { bundleApp } from "@/lib/preview/bundler";
import { Skeleton } from "@/components/ui/skeleton";
import { buildViteProject } from "@/lib/export/vite-project";
import { buildDeliveryChecklist, buildHandoffDocuments } from "@/lib/delivery/commercial-handoff";
import {
  parseReleaseProbeMessage,
  releaseProbeUrl,
  type ReleaseVerificationSnapshot,
} from "@/lib/delivery/release-verification";
import { replaceProjectMedia, type ProjectMediaAsset, type ProjectMediaItem } from "@/lib/media/project-media";
import { sanitizePromptAttachments, type PromptAttachment } from "@/lib/engine/prompt-attachments";
import { buildAcceptanceReport } from "@/lib/engine/acceptance-report";
import { projectGenerationPlan } from "@/lib/engine/generation-contract";
import { acceptanceRepairFingerprint, buildAcceptanceRepairPrompt } from "@/lib/engine/acceptance-repair";
import { appCodeFingerprint, blockingIssueCodes, evaluateRepairCandidate, mergeBlockingIssueCodes } from "@/lib/engine/acceptance-repair-cycle";
import type { RuntimeAuditReport } from "@/lib/preview/runtime-audit";
import { findPreviewSourceCandidates, type PreviewElementSelection } from "@/lib/preview/visual-selection";
import { applyDirectVisualLinkEdit, applyDirectVisualStructureEdit, applyDirectVisualStyleEdit, applyDirectVisualStyleValues, applyDirectVisualTextEdit, type DirectVisualStructureAction, type DirectVisualStylePreset, type DirectVisualStyleValues } from "@/lib/preview/direct-visual-edit";

interface ProjectRow {
  id: string;
  name: string;
  schema: any;
  published: boolean;
  share_slug: string | null;
  meta: any;
  build_bundle: string | null;
}

const RELEASE_PROBE_TIMEOUT_MS = 20_000;

async function verifyPublishedRelease(slug: string, expectsRuntime: boolean): Promise<void> {
  const nonce = crypto.randomUUID();
  const url = releaseProbeUrl(slug, nonce);
  if (!expectsRuntime) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`A página publicada respondeu HTTP ${response.status}.`);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.title = "Verificação da publicação";
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.width = "1px";
    iframe.style.height = "1px";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";
    iframe.style.left = "-10000px";

    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      iframe.remove();
      if (error) reject(error);
      else resolve();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== iframe.contentWindow) return;
      const message = parseReleaseProbeMessage(event.data);
      if (!message) return;
      if (message.status === "error") {
        finish(new Error(message.message || "O aplicativo publicado falhou ao iniciar."));
      } else {
        finish();
      }
    };
    const timer = window.setTimeout(() => {
      finish(new Error("A versão pública não confirmou a inicialização dentro de 20 segundos."));
    }, RELEASE_PROBE_TIMEOUT_MS);

    window.addEventListener("message", onMessage);
    iframe.src = url;
    document.body.appendChild(iframe);
  });
}

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
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
  const [starterAttachments, setStarterAttachments] = useState<PromptAttachment[]>([]);
  const [notFound, setNotFound] = useState(false);

  // Modo do projeto: site (schema) | app (código) | empty
  const [mode, setMode] = useState<ProjectMode>("empty");
  const [appCode, setAppCode] = useState<string | null>(null);
  const [appFiles, setAppFiles] = useState<AppFile[] | null>(null);
  const [appEntry, setAppEntry] = useState<string | null>(null);
  const [appName, setAppName] = useState<string>("App");
  const [appVer, setAppVer] = useState(0);
  const [engineMode, setEngineMode] = useState<EngineMode | null>(null);
  const [appView, setAppView] = useState<"preview" | "code" | "data" | "media" | "quality">("preview");
  const [visualSelection, setVisualSelection] = useState<PreviewElementSelection | null>(null);
  const [focusedMediaSource, setFocusedMediaSource] = useState<string | null>(null);
  const [views, setViews] = useState<number | null>(null);

  // Visitas do site publicado (analytics agregado). Só busca quando publicado.
  useEffect(() => {
    if (!project?.published || !projectId) return;
    fetch(`/api/view/${projectId}`)
      .then((r) => r.json())
      .then((d) => setViews(typeof d?.views === "number" ? d.views : 0))
      .catch(() => {});
  }, [project?.published, projectId]);

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
  const [repairState, setRepairState] = useState<AcceptanceRepairSnapshot | undefined>();
  const repairStateRef = useRef<AcceptanceRepairSnapshot | undefined>();
  const latestAuditRef = useRef<RuntimeAuditReport | undefined>();
  const lastAutoFixTriggerRef = useRef("");
  const autoFixFinishingRef = useRef(false);
  const [previewHealth, setPreviewHealth] = useState<"checking" | "healthy" | "error">("checking");
  const lastHealthyApp = useRef<AppCode | null>(null);
  const pendingAppApproval = useRef<{ app: AppCode; label: string; acceptance?: ProjectAcceptanceSnapshot } | null>(null);
  const approvingApp = useRef(false);

  /* ── Carregamento ─────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: proj, error } = await supabase
        .from("projects")
        .select("id, name, schema, published, share_slug, meta, build_bundle")
        .eq("id", projectId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !proj) {
        setNotFound(true);
        return;
      }
      setProject(proj as ProjectRow);
      let loadedMeta = readMeta(proj.meta);
      const persistedRepair = loadedMeta.acceptance?.repair;
      if (persistedRepair && (persistedRepair.status === "repairing" || persistedRepair.status === "verifying")) {
        const interrupted: AcceptanceRepairSnapshot = {
          ...persistedRepair,
          status: "failed",
          updatedAt: new Date().toISOString(),
          lastError: "O ciclo foi interrompido antes da verificação final. A versão saudável permaneceu salva.",
        };
        loadedMeta = {
          ...loadedMeta,
          acceptance: { ...loadedMeta.acceptance, repair: interrupted, updatedAt: interrupted.updatedAt } as ProjectAcceptanceSnapshot,
        };
        void supabase.from("projects").update({ meta: loadedMeta, updated_at: interrupted.updatedAt }).eq("id", projectId);
      }
      setMeta(loadedMeta);
      setRepairState(loadedMeta.acceptance?.repair);
      repairStateRef.current = loadedMeta.acceptance?.repair;
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
        const rawAttachments = sessionStorage.getItem(`nexaform:starter-attachments:${projectId}`);
        sessionStorage.removeItem(`nexaform:starter-attachments:${projectId}`);
        if (rawAttachments) {
          try { setStarterAttachments(sanitizePromptAttachments(JSON.parse(rawAttachments))); } catch {}
        }
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
      const previous = currentApp();
      if (previewHealth === "healthy" && previous) lastHealthyApp.current = previous;
      setPreviewHealth("checking");
      latestAuditRef.current = undefined;
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
      const label = result.plan[0] ?? "Geração de app";
      const existingAcceptance = metaRef.current.acceptance;
      let currentRepair = repairStateRef.current;
      if (currentRepair?.status === "repairing") {
        currentRepair = {
          ...currentRepair,
          status: "verifying",
          candidateAppFingerprint: appCodeFingerprint(result.app),
          resolvedIssueCodes: undefined,
          introducedIssueCodes: undefined,
          updatedAt: new Date().toISOString(),
        };
        repairStateRef.current = currentRepair;
        setRepairState(currentRepair);
      }
      pendingAppApproval.current = {
        app: result.app,
        label: label.slice(0, 120),
        acceptance: {
          // Um refinamento curto (ex.: "troque a cor") não deve apagar o
          // contrato original do produto. Em um projeto novo, usamos o plano
          // recém-criado pelo motor.
          plan: projectGenerationPlan(existingAcceptance?.plan, result.generationPlan, !!previous),
          structural: result.quality,
          repair: currentRepair,
          updatedAt: new Date().toISOString(),
        },
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentApp, previewHealth, projectId, supabase]
  );

  const handleAppCheckpoint = useCallback((app: AppCode) => {
    setPreviewHealth("checking");
    latestAuditRef.current = undefined;
    pendingAppApproval.current = null;
    setMode("app");
    setAppName(app.name ?? "App");
    if (isMultiFile(app)) {
      setAppFiles(app.files);
      setAppEntry(app.entry);
      setAppCode(null);
    } else {
      setAppCode(app.code ?? null);
      setAppFiles(null);
      setAppEntry(null);
    }
    setAppVer((value) => value + 1);
  }, []);

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
    if (mode === "app" && previewHealth !== "healthy") {
      toast.error("O preview ainda não foi aprovado", {
        description: previewHealth === "error"
          ? "Corrija o erro de execução antes de publicar. A última versão saudável continua protegida."
          : "Aguarde alguns segundos enquanto o AD Studio verifica o aplicativo.",
      });
      return null;
    }
    if (mode === "app") {
      const acceptance = metaRef.current.acceptance;
      const report = buildAcceptanceReport({
        app: appPayload,
        plan: acceptance?.plan,
        structural: acceptance?.structural,
        runtime: acceptance?.runtime,
        previewHealth,
      });
      if (report.blockers > 0) {
        setAppView("quality");
        toast.error("O Centro de Qualidade bloqueou a publicação", {
          description: "Abra a aba Qualidade para ver a falha comprovada que precisa ser corrigida.",
        });
        return null;
      }
    }
    const slug = project.share_slug ?? nanoid(10);
    const payload = mode === "app" ? appPayload : store.schema;

    // Build de produção obrigatório: o link do cliente nunca deve depender do
    // runtime Babel de contingência. Se o bundle falhar, preserva integralmente
    // a publicação anterior e informa a causa antes de colocar algo quebrado no ar.
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
        if (!buildBundle) throw new Error("O bundler não produziu o arquivo de produção.");
      } catch (error) {
        toast.error("A publicação foi bloqueada antes de ir ao ar", {
          description: error instanceof Error
            ? error.message
            : "Não foi possível compilar a versão de produção.",
        });
        return null;
      }
    }

    if (mode === "app") {
      const backendReady = await provisionCurrentBackend(false);
      if (!backendReady) return null;
    }

    const { data: previousRelease, error: snapshotError } = await supabase
      .from("projects")
      .select("published, share_slug, schema, build_bundle")
      .eq("id", project.id)
      .single();
    if (snapshotError || !previousRelease) {
      toast.error("Não foi possível proteger a publicação anterior");
      return null;
    }

    const { error } = await supabase
      .from("projects")
      .update({ published: true, share_slug: slug, schema: payload, build_bundle: buildBundle })
      .eq("id", project.id);
    if (error) {
      toast.error("Não foi possível publicar");
      return null;
    }

    try {
      await verifyPublishedRelease(slug, mode === "app");
    } catch (verificationError) {
      const { error: rollbackError } = await supabase
        .from("projects")
        .update({
          published: previousRelease.published,
          share_slug: previousRelease.share_slug,
          schema: previousRelease.schema,
          build_bundle: previousRelease.build_bundle,
        })
        .eq("id", project.id);
      const checkedAt = new Date().toISOString();
      const failedVerification: ReleaseVerificationSnapshot = {
        version: 1,
        status: "failed",
        slug,
        checkedAt,
        bundleBytes: buildBundle?.length || 0,
        message: verificationError instanceof Error
          ? verificationError.message.slice(0, 800)
          : "A versão pública não iniciou.",
      };
      await handleMetaChange({
        delivery: {
          ...(metaRef.current.delivery || {}),
          releaseVerification: failedVerification,
        },
      });
      toast.error("A versão pública falhou na verificação", {
        description: rollbackError
          ? "A publicação foi bloqueada, mas a restauração automática precisa ser conferida no histórico."
          : `${failedVerification.message} A publicação anterior foi restaurada.`,
      });
      return null;
    }

    const verifiedAt = new Date().toISOString();
    const releaseVerification: ReleaseVerificationSnapshot = {
      version: 1,
      status: "verified",
      slug,
      checkedAt: verifiedAt,
      bundleBytes: buildBundle?.length || 0,
    };
    await handleMetaChange({
      delivery: {
        ...(metaRef.current.delivery || {}),
        releaseVerification,
      },
    });
    setProject({ ...project, published: true, share_slug: slug, build_bundle: buildBundle });
    toast.success("Publicação verificada", {
      description: "O link público abriu e o aplicativo confirmou a inicialização.",
    });
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

    // App React → projeto Vite completo, executável e pronto para deploy.
    if (mode === "app") {
      try {
        const [{ default: JSZip }] = await Promise.all([import("jszip")]);
        const zip = new JSZip();
        const root = zip.folder(safeName)!;
        const sourceFiles: AppFile[] = appFiles && appFiles.length
          ? appFiles
          : [{ path: "App.jsx", content: appCode ?? "" }];
        if (!sourceFiles[0]?.content) throw new Error("O projeto ainda não possui código para exportar.");
        const apiOrigin = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
        const exportFiles = buildViteProject({
          files: sourceFiles,
          entry: appEntry ?? sourceFiles[0].path,
          projectName: project?.name ?? "Projeto",
          projectId,
          apiOrigin,
        });
        for (const file of exportFiles) root.file(file.path, file.content);
        const blob = await zip.generateAsync({ type: "blob" });
        downloadBlob(blob, `${safeName}.zip`);
        toast.success("Projeto Vite exportado", {
          description: "O ZIP inclui scripts, Tailwind, dependências, backend AD e instruções de deploy.",
        });
      } catch (e: any) {
        toast.error("Não foi possível gerar o .zip", { description: e?.message });
      }
      return;
    }

    // Projetos antigos do editor visual preservam o schema para reimportação.
    const content = JSON.stringify(store.schema, null, 2);
    if (!content) {
      toast.error("Nada para exportar ainda");
      return;
    }
    downloadBlob(
      new Blob([content], { type: "application/json" }),
      `${safeName}.adstudio.json`
    );
    toast.success("Exportado");
  }

  async function handleCommercialExport() {
    if (!project) return;
    const plan = resolvePlan(access);
    if (!plan.canExport) {
      toast.error("Pacote comercial disponível no plano Pro");
      return;
    }
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const safeName = (project.name || "projeto").replace(/[^\w.-]+/g, "-").slice(0, 60) || "projeto";
      const root = zip.folder(`${safeName}-entrega`)!;
      const publicUrl = project.published && project.share_slug
        ? `${window.location.origin}/p/${project.share_slug}`
        : null;
      const checklist = buildDeliveryChecklist({
        meta: metaRef.current,
        published: project.published,
        shareSlug: project.share_slug,
        canExport: plan.canExport,
        qualityRequired: mode === "app",
      });
      const documents = buildHandoffDocuments({
        projectName: project.name,
        projectId,
        publicUrl,
        meta: metaRef.current,
        checklist,
      });
      for (const file of documents) root.file(file.path, file.content);

      if (mode === "app") {
        const sourceFiles: AppFile[] = appFiles && appFiles.length
          ? appFiles
          : [{ path: "App.jsx", content: appCode ?? "" }];
        if (!sourceFiles[0]?.content) throw new Error("O projeto ainda não possui código para entregar.");
        const appFolder = root.folder("app")!;
        const exportFiles = buildViteProject({
          files: sourceFiles,
          entry: appEntry ?? sourceFiles[0].path,
          projectName: project.name,
          projectId,
          apiOrigin: process.env.NEXT_PUBLIC_APP_URL || window.location.origin,
        });
        for (const file of exportFiles) appFolder.file(file.path, file.content);
      } else if (store.schema) {
        root.file("projeto.adstudio.json", JSON.stringify(store.schema, null, 2));
      }

      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, `${safeName}-entrega.zip`);
      toast.success("Pacote comercial gerado", {
        description: "Inclui código, identidade, checklist, qualidade e instruções de handoff.",
      });
    } catch (error: any) {
      toast.error("Não foi possível gerar o pacote comercial", { description: error?.message });
    }
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
    setPreviewHealth("checking");
    latestAuditRef.current = undefined;
    setAppView("preview");
    pendingAppApproval.current = {
      app,
      label: "Edição manual de código",
      acceptance: {
        plan: metaRef.current.acceptance?.plan,
        updatedAt: new Date().toISOString(),
      },
    };
    toast.info("Código em verificação", { description: "A alteração será salva depois que o preview for aprovado." });
  }

  async function handleDirectVisualEdit(text: string): Promise<boolean> {
    if (!visualSelection) return false;
    const result = applyDirectVisualTextEdit(codeFiles, visualSelection, text);
    if (!result.changed) {
      const descriptions = {
        empty_text: "Digite um texto antes de aplicar.",
        unsupported_element: "Esse tipo de elemento precisa ser alterado pelo pedido à IA.",
        unsafe_value: "O valor informado foi bloqueado por segurança.",
        source_not_found: "O texto é dinâmico ou composto. Descreva a mudança no campo abaixo.",
        ambiguous_source: "O mesmo texto aparece em mais de um lugar. Descreva qual deles deve mudar.",
        changed: "",
      } as const;
      toast.info("Use o refinamento assistido para este elemento", {
        description: descriptions[result.reason],
      });
      return false;
    }
    setVisualSelection(null);
    await handleApplyCode(result.files);
    toast.success("Texto alterado no preview", {
      description: `${result.path} será salvo após a verificação automática.`,
    });
    return true;
  }

  async function handleDirectVisualStyleEdit(preset: DirectVisualStylePreset): Promise<boolean> {
    if (!visualSelection) return false;
    const result = applyDirectVisualStyleEdit(codeFiles, visualSelection, preset);
    if (!result.changed) {
      toast.info("Use o refinamento assistido para este elemento", {
        description: result.reason === "ambiguous_source"
          ? "Há mais de um elemento igual no código. Descreva qual deles deve mudar."
          : "Este elemento usa estilo ou conteúdo dinâmico e precisa ser alterado pela IA.",
      });
      return false;
    }
    setVisualSelection(null);
    await handleApplyCode(result.files);
    toast.success("Aparência alterada no preview", {
      description: `${result.path} será salvo após a verificação automática.`,
    });
    return true;
  }

  async function handleDirectVisualStyleValues(values: DirectVisualStyleValues): Promise<boolean> {
    if (!visualSelection) return false;
    const result = applyDirectVisualStyleValues(codeFiles, visualSelection, values);
    if (!result.changed) {
      toast.info("Use o refinamento assistido para este elemento", {
        description: result.reason === "unsafe_value"
          ? "Revise os valores de aparência informados."
          : "O elemento usa estilo dinâmico ou não pôde ser localizado de forma única.",
      });
      return false;
    }
    setVisualSelection(null);
    await handleApplyCode(result.files);
    toast.success("Estilo personalizado aplicado", {
      description: `${result.path} será salvo após a verificação automática.`,
    });
    return true;
  }

  function handleOpenSelectedMedia() {
    if (!visualSelection?.src) return;
    setFocusedMediaSource(visualSelection.src);
    setAppView("media");
  }

  async function handleDirectVisualLinkEdit(href: string): Promise<boolean> {
    if (!visualSelection) return false;
    const result = applyDirectVisualLinkEdit(codeFiles, visualSelection, href);
    if (!result.changed) {
      toast.info("Não foi possível alterar este link diretamente", {
        description: result.reason === "unsafe_value"
          ? "Use HTTPS, um caminho interno, âncora, e-mail ou telefone. Protocolos executáveis são bloqueados."
          : "O destino é dinâmico ou aparece em mais de um elemento. Use o refinamento assistido.",
      });
      return false;
    }
    setVisualSelection(null);
    await handleApplyCode(result.files);
    toast.success("Destino do link alterado", {
      description: `${result.path} será salvo após a verificação automática.`,
    });
    return true;
  }

  async function handleDirectVisualStructureEdit(action: DirectVisualStructureAction): Promise<boolean> {
    if (!visualSelection || !appFiles?.length || !appEntry) return false;
    const candidates = findPreviewSourceCandidates(visualSelection, appFiles);
    const result = applyDirectVisualStructureEdit(appFiles, appEntry, candidates, action);
    if (!result.changed) {
      toast.info("Esta seção precisa do refinamento assistido", {
        description: result.reason === "ambiguous_source"
          ? "Encontrei mais de uma seção possível e preservei o projeto para não alterar a errada."
          : result.reason === "unsupported_element"
            ? "A seção já está no limite dessa direção ou usa uma composição dinâmica."
            : "Não consegui ligar este elemento a um componente único do App.jsx.",
      });
      return false;
    }
    setVisualSelection(null);
    await handleApplyCode(result.files);
    const labels: Record<DirectVisualStructureAction, string> = {
      moveUp: "Seção movida para cima",
      moveDown: "Seção movida para baixo",
      duplicate: "Seção duplicada",
      remove: "Seção removida",
    };
    toast.success(labels[action], {
      description: `${result.path} será salvo depois da verificação automática. O histórico permite restaurar a versão anterior.`,
    });
    return true;
  }

  async function handleReplaceMedia(item: ProjectMediaItem, url: string) {
    const edited = replaceProjectMedia(codeFiles, item, url);
    if (!edited) {
      toast.error("A mídia mudou desde a seleção", { description: "Atualize a Central de Mídia e tente novamente." });
      return;
    }

    let app: AppCode;
    if (appFiles && appFiles.length) {
      setAppFiles(edited);
      const entry = edited.some((file) => file.path === appEntry) ? appEntry! : edited[0].path;
      setAppEntry(entry);
      app = { kind: "app", name: appName, description: "", files: edited, entry };
    } else {
      const code = edited[0]?.content || "";
      setAppCode(code);
      app = { kind: "app", name: appName, description: "", code };
    }
    setAppVer((value) => value + 1);
    setPreviewHealth("checking");
    latestAuditRef.current = undefined;
    setAppView("preview");
    pendingAppApproval.current = {
      app,
      label: `Mídia: ${item.context}`.slice(0, 120),
      acceptance: {
        plan: metaRef.current.acceptance?.plan,
        updatedAt: new Date().toISOString(),
      },
    };
    toast.info("Mídia aplicada ao preview", { description: "A versão será salva depois da verificação." });
  }

  async function handleMediaAssetsChange(assets: ProjectMediaAsset[]) {
    await handleMetaChange({ media: assets });
  }

  const MAX_AUTOFIX = 3;
  function updateRepairState(next: AcceptanceRepairSnapshot, persist = true) {
    repairStateRef.current = next;
    setRepairState(next);
    const pending = pendingAppApproval.current;
    if (pending?.acceptance) pending.acceptance = { ...pending.acceptance, repair: next, updatedAt: next.updatedAt };
    if (!persist) return;
    const acceptance = { ...metaRef.current.acceptance, repair: next, updatedAt: next.updatedAt } as ProjectAcceptanceSnapshot;
    const nextMeta = { ...metaRef.current, acceptance };
    metaRef.current = nextMeta;
    setMeta(nextMeta);
    void supabase.from("projects").update({ meta: nextMeta, updated_at: next.updatedAt }).eq("id", projectId);
  }

  function queueAutoRepair(message: string, forceRetry = false) {
    if (!forceRetry && repairStateRef.current?.status === "repairing") return;
    if (autoFixCount.current >= MAX_AUTOFIX) {
      finishFailedAutoFix();
      return;
    }

    const acceptance = pendingAppApproval.current?.acceptance || metaRef.current.acceptance;
    const runtime = latestAuditRef.current || acceptance?.runtime;
    const structural = acceptance?.structural;
    const fingerprint = acceptanceRepairFingerprint({ runtime, structural, fallbackError: message });
    autoFixCount.current += 1;
    autoFixFinishingRef.current = false;
    lastAutoFixTriggerRef.current = message;
    const now = new Date().toISOString();
    const previous = repairStateRef.current;
    const issueCodes = blockingIssueCodes(runtime, structural).slice(0, 20);
    const next: AcceptanceRepairSnapshot = {
      status: "repairing",
      attempt: autoFixCount.current,
      maxAttempts: MAX_AUTOFIX,
      fingerprint,
      issueCodes,
      startedAt: previous?.fingerprint === fingerprint ? previous.startedAt : now,
      updatedAt: now,
      lastError: message.slice(0, 800),
      baselineAppFingerprint: appCodeFingerprint(currentApp()),
      candidateAppFingerprint: undefined,
      resolvedIssueCodes: undefined,
      introducedIssueCodes: undefined,
      verifiedAt: undefined,
    };
    updateRepairState(next);
    setAutoFixError(buildAcceptanceRepairPrompt({
      runtime,
      structural,
      plan: acceptance?.plan,
      fallbackError: message,
      attempt: next.attempt,
      maxAttempts: next.maxAttempts,
    }));
    toast.info(`Corrigindo automaticamente (tentativa ${next.attempt}/${next.maxAttempts})…`, {
      description: "O Centro de Qualidade enviou somente as falhas comprovadas e preservou a última versão saudável.",
    });
  }

  function finishFailedAutoFix() {
    if (autoFixFinishingRef.current) return;
    autoFixFinishingRef.current = true;
    const previous = repairStateRef.current;
    if (previous) {
      updateRepairState({
        ...previous,
        status: "failed",
        updatedAt: new Date().toISOString(),
        lastError: lastAutoFixTriggerRef.current.slice(0, 800) || previous.lastError,
      });
    }
    void restoreLastHealthyApp().then((restored) => {
      setAppView("quality");
      toast.error(restored ? "Restaurei a última versão que funcionava" : "Não consegui corrigir sozinho", {
        description: restored
          ? "O código quebrado não será publicado. Você pode tentar o refinamento novamente sem perder o aplicativo anterior."
          : "Tentei algumas vezes. Me diga no chat o que o app deveria fazer que eu ajusto.",
      });
    });
  }

  async function restoreLastHealthyApp() {
    const safe = lastHealthyApp.current;
    if (!safe) return false;
    setAppName(safe.name ?? "App");
    if (isMultiFile(safe)) {
      setAppFiles(safe.files);
      setAppEntry(safe.entry);
      setAppCode(null);
    } else {
      setAppCode(safe.code ?? null);
      setAppFiles(null);
      setAppEntry(null);
    }
    setPreviewHealth("checking");
    latestAuditRef.current = undefined;
    setAutoFixError(null);
    pendingAppApproval.current = null;
    setAppVer((value) => value + 1);
    await supabase.from("projects").update({ schema: safe, updated_at: new Date().toISOString() }).eq("id", projectId);
    const { data } = await supabase
      .from("versions")
      .insert({ project_id: projectId, schema: safe, label: "Recuperação: última versão saudável" })
      .select("id, label, created_at, schema")
      .single();
    if (data) setVersions((current) => [data as VersionRow, ...current]);
    return true;
  }

  function handleAppError(message: string) {
    setPreviewHealth("error");
    queueAutoRepair(message);
  }

  function handleAutoFixFailed() {
    if (autoFixCount.current >= MAX_AUTOFIX) {
      finishFailedAutoFix();
      return;
    }
    window.setTimeout(() => queueAutoRepair(lastAutoFixTriggerRef.current || "A tentativa anterior não retornou uma alteração válida.", true), 400);
  }

  function handleAppReady() {
    const safe = currentApp();
    const repair = repairStateRef.current;
    if (repair && (repair.status === "repairing" || repair.status === "verifying") && safe) {
      const pending = pendingAppApproval.current;
      const evaluation = evaluateRepairCandidate({
        baselineAppFingerprint: repair.baselineAppFingerprint || "none",
        baselineIssueCodes: repair.issueCodes,
        candidate: safe,
        structural: pending?.acceptance?.structural,
        runtime: latestAuditRef.current || pending?.acceptance?.runtime,
        repairStartedAt: repair.updatedAt,
      });
      if (!evaluation.approved) {
        const reason = evaluation.reason === "unchanged"
          ? "A IA não alterou o código que causou a falha."
          : evaluation.reason === "audit_missing"
          ? "A correção ainda não recebeu uma auditoria nova de desktop e mobile."
          : "A versão candidata ainda contém uma falha comprovada.";
        setPreviewHealth("error");
        updateRepairState({
          ...repair,
          candidateAppFingerprint: evaluation.candidateFingerprint,
          resolvedIssueCodes: evaluation.resolvedIssueCodes,
          introducedIssueCodes: evaluation.introducedIssueCodes,
          updatedAt: new Date().toISOString(),
          lastError: reason,
        });
        lastAutoFixTriggerRef.current = reason;
        handleAutoFixFailed();
        return;
      }
      const verifiedAt = new Date().toISOString();
      updateRepairState({
        ...repair,
        status: "verified",
        candidateAppFingerprint: evaluation.candidateFingerprint,
        resolvedIssueCodes: evaluation.resolvedIssueCodes,
        introducedIssueCodes: evaluation.introducedIssueCodes,
        verifiedAt,
        updatedAt: verifiedAt,
        lastError: undefined,
      }, !pendingAppApproval.current);
    }
    setPreviewHealth("healthy");
    if (safe) lastHealthyApp.current = safe;
    autoFixCount.current = 0;
    autoFixFinishingRef.current = false;
    lastAutoFixTriggerRef.current = "";
    void approvePendingApp();
  }

  function handlePreviewAudit(report: RuntimeAuditReport) {
    latestAuditRef.current = report;
    const pending = pendingAppApproval.current;
    const activeRepair = repairStateRef.current;
    if (activeRepair && (activeRepair.status === "repairing" || activeRepair.status === "verifying")) {
      const issueCodes = mergeBlockingIssueCodes(
        activeRepair.issueCodes,
        report,
        pending?.acceptance?.structural || metaRef.current.acceptance?.structural
      ).slice(0, 20);
      if (issueCodes.join("|") !== activeRepair.issueCodes.join("|")) {
        updateRepairState({ ...activeRepair, issueCodes });
      }
    }
    if (pending) {
      pending.acceptance = {
        ...pending.acceptance,
        runtime: report,
        repair: repairStateRef.current,
        updatedAt: new Date().toISOString(),
      };
      return;
    }
    void handleMetaChange({
      acceptance: {
        ...metaRef.current.acceptance,
        runtime: report,
        updatedAt: new Date().toISOString(),
      },
    });
  }

  function handleManualQualityRepair() {
    autoFixCount.current = 0;
    autoFixFinishingRef.current = false;
    const runtime = latestAuditRef.current || metaRef.current.acceptance?.runtime;
    const blocking = runtime?.issues.filter((issue) => issue.severity === "error") || [];
    const message = blocking.length
      ? blocking.map((issue) => issue.message).join(" | ")
      : "O Centro de Qualidade bloqueou a versão atual; corrija a causa comprovada sem alterar áreas saudáveis.";
    queueAutoRepair(message, true);
    setAppView("preview");
  }

  function handleManualGenerationStart() {
    autoFixCount.current = 0;
    autoFixFinishingRef.current = false;
    lastAutoFixTriggerRef.current = "";
    const acceptance = metaRef.current.acceptance;
    if (!repairStateRef.current || !acceptance) return;
    repairStateRef.current = undefined;
    setRepairState(undefined);
    const { repair: _repair, ...withoutRepair } = acceptance;
    const nextMeta = { ...metaRef.current, acceptance: { ...withoutRepair, updatedAt: new Date().toISOString() } };
    metaRef.current = nextMeta;
    setMeta(nextMeta);
    void supabase.from("projects").update({ meta: nextMeta, updated_at: nextMeta.acceptance.updatedAt }).eq("id", projectId);
  }

  async function approvePendingApp() {
    const pending = pendingAppApproval.current;
    if (!pending || approvingApp.current) return;
    approvingApp.current = true;
    try {
      const nextMeta = pending.acceptance
        ? { ...metaRef.current, acceptance: pending.acceptance }
        : metaRef.current;
      const { error } = await supabase
        .from("projects")
        .update({ schema: pending.app, meta: nextMeta, updated_at: new Date().toISOString() })
        .eq("id", projectId);
      if (error) throw error;
      if (pending.acceptance) {
        metaRef.current = nextMeta;
        setMeta(nextMeta);
      }
      const { data } = await supabase
        .from("versions")
        .insert({ project_id: projectId, schema: pending.app, label: pending.label })
        .select("id, label, created_at, schema")
        .single();
      if (pendingAppApproval.current === pending) pendingAppApproval.current = null;
      if (data) setVersions((current) => [data as VersionRow, ...current]);
      await provisionCurrentBackend(true);
      toast.success("Preview aprovado e versão salva");
    } catch {
      toast.error("O preview funcionou, mas não consegui salvar", {
        description: "A alteração continua aberta. Recarregue o preview para tentar salvar novamente.",
      });
    } finally {
      approvingApp.current = false;
    }
  }

  async function provisionCurrentBackend(silent: boolean): Promise<boolean> {
    try {
      const response = await fetch(`/api/backend/${projectId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apply: true }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || "Falha ao configurar o backend.");
      if (json.provisioning) {
        const nextMeta = { ...metaRef.current, backendProvisioning: json.provisioning };
        metaRef.current = nextMeta;
        setMeta(nextMeta);
      }
      if (json.blueprint?.status === "review" && !silent) {
        toast.warning("Backend seguro, com revisão pendente", {
          description: "Coleções ambíguas permaneceram privadas. Confira a aba Dados antes de divulgar o aplicativo.",
        });
      }
      return true;
    } catch (error: any) {
      toast.error("O backend automático não foi concluído", {
        description: error?.message || "Abra a aba Dados e tente configurar novamente.",
      });
      return false;
    }
  }

  function handleRestoreVersion(v: VersionRow) {
    if (isAppCode(v.schema)) {
      const previous = currentApp();
      if (previewHealth === "healthy" && previous) lastHealthyApp.current = previous;
      pendingAppApproval.current = null;
      setPreviewHealth("checking");
      latestAuditRef.current = undefined;
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
        projectId={projectId}
        currentSchema={mode === "app" ? currentApp() : store.schema}
        published={project.published}
        shareSlug={project.share_slug}
        canExport={resolvePlan(access).canExport}
        qualityRequired={mode === "app"}
        versions={versions}
        meta={meta}
        studio={isOwner(access)}
        onRename={handleRename}
        onRestoreVersion={handleRestoreVersion}
        onVersionRenamed={(id, label) =>
          setVersions((cur) => cur.map((v) => (v.id === id ? { ...v, label } : v)))
        }
        onPublish={handlePublish}
        onExport={handleExport}
        onCommercialExport={handleCommercialExport}
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
            starterAttachments={starterAttachments}
            autoFixError={autoFixError}
            onAutoFixHandled={() => setAutoFixError(null)}
            onAutoFixFailed={handleAutoFixFailed}
            onUserSend={handleManualGenerationStart}
            onSiteResult={handleSiteResult}
            onAppResult={handleAppResult}
            onAppCheckpoint={handleAppCheckpoint}
            onGeneratingChange={setGenerating}
            onEngineMode={setEngineMode}
            visualSelection={visualSelection}
            onClearVisualSelection={() => setVisualSelection(null)}
            onDirectVisualEdit={handleDirectVisualEdit}
            onDirectVisualStyleEdit={handleDirectVisualStyleEdit}
            onDirectVisualStyleValues={handleDirectVisualStyleValues}
            onOpenSelectedMedia={handleOpenSelectedMedia}
            onDirectVisualLinkEdit={handleDirectVisualLinkEdit}
            onDirectVisualStructureEdit={appFiles?.length && appEntry ? handleDirectVisualStructureEdit : undefined}
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
                  <button
                    onClick={() => setAppView("media")}
                    title="Gere no ChatGPT/Genspark, envie e substitua imagens ou vídeos"
                    className={cn(
                      "rounded-md px-2.5 py-1 font-medium transition-colors",
                      appView === "media" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Mídia
                  </button>
                  <button
                    onClick={() => setAppView("quality")}
                    title="Contrato, checklist funcional e liberação para publicação"
                    className={cn(
                      "rounded-md px-2.5 py-1 font-medium transition-colors",
                      appView === "quality" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Qualidade
                  </button>
                </div>
                {project?.published && views !== null && (
                  <span
                    className="ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                    title="Visitas do site publicado"
                  >
                    <span aria-hidden>👁</span>
                    {views.toLocaleString("pt-BR")} {views === 1 ? "visita" : "visitas"}
                  </span>
                )}
              </div>
              <div className="min-h-0 flex-1">
                {appView === "data" ? (
                  <DataPanel projectId={projectId} />
                ) : appView === "media" ? (
                  <MediaPanel
                    projectId={projectId}
                    projectName={project.name}
                    files={codeFiles}
                    assets={meta.media || []}
                    focusSource={focusedMediaSource}
                    onReplace={handleReplaceMedia}
                    onAssetsChange={handleMediaAssetsChange}
                  />
                ) : appView === "quality" ? (
                  <AcceptancePanel
                    app={currentApp()}
                    acceptance={meta.acceptance}
                    repair={repairState}
                    previewHealth={previewHealth}
                    onRepair={handleManualQualityRepair}
                  />
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
                    editorSession
                    onError={handleAppError}
                    onReady={handleAppReady}
                    onAudit={handlePreviewAudit}
                    onElementSelect={setVisualSelection}
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
