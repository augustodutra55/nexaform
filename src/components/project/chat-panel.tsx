"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowUp, Check, Loader2, Sparkles, Code2, Layout, Mic, Square, Cpu, FileCode2, AlertTriangle, Paperclip, X, Image as ImageIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AppSchema, GenerationResult } from "@/lib/engine/types";
import { AppFile, AppGenerationResult, CodeStats, EngineMode, MediaGenerationReport, looksLikeApp } from "@/lib/engine/app-types";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useSpeechInput } from "@/hooks/use-speech-input";
import {
  attachmentLabel,
  attachmentPayloadBytes,
  MAX_PROMPT_ATTACHMENTS,
  MAX_PROMPT_TOTAL_BYTES,
  preparePromptAttachment,
  PROMPT_ATTACHMENT_ACCEPT,
  type PromptAttachment,
} from "@/lib/engine/prompt-attachments";
import {
  buildMasterPrompt,
  buildStagePrompt,
  buildStageRetryPrompt,
  isValidStagedBuildJob,
  shouldStageInitialBuild,
  shouldStageRefinement,
  stagedJobForCloud,
  stagedStages,
  STAGED_BUILD_VERSION,
  type StagedBuildJob,
} from "@/lib/engine/staged-generation";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface FailedRefinementRequest {
  messageId: string;
  prompt: string;
}

const REFINEMENT_FAILURE = /(?:edi[çc][aã]o n[aã]o foi aplicada|resposta[^.]*n[aã]o p[oô]de ser interpretada como c[oó]digo|gera[çc][aã]o passou do tempo limite)/i;

function failedRefinementRequests(messages: Message[], recoveredIds: string[]): FailedRefinementRequest[] {
  const recovered = new Set(recoveredIds);
  const failed = new Map<string, FailedRefinementRequest>();
  let pendingUser: Message | null = null;
  for (const message of messages) {
    if (message.role === "user") {
      pendingUser = message.content.startsWith("⚙️ Correção automática:") ? null : message;
      continue;
    }
    if (!pendingUser) continue;
    const key = pendingUser.content.trim().replace(/\s+/g, " ");
    if (REFINEMENT_FAILURE.test(message.content)) {
      if (!recovered.has(pendingUser.id)) {
        failed.set(key, { messageId: pendingUser.id, prompt: pendingUser.content });
      }
    } else if (!/^⚠️ A alteração principal/.test(message.content)) {
      failed.delete(key);
    }
    pendingUser = null;
  }
  return Array.from(failed.values());
}

/** Geração de código: REAL (IA escreve) ou TEMPLATE (enlatado/demo permitido). */
type GenMode = "real" | "template";

interface GenEvidence {
  engineMode: EngineMode;
  provider: string;
  model?: string;
  stats?: CodeStats;
  cost?: number;
  media?: MediaGenerationReport;
}

export type ProjectMode = "empty" | "site" | "app";

interface ChatPanelProps {
  projectId: string;
  threadId: string;
  initialMessages: Message[];
  mode: ProjectMode;
  schema: AppSchema | null;
  code: string | null;
  /** Arquivos do projeto multi-arquivo (para refinamento incremental). */
  files?: AppFile[] | null;
  projectName: string;
  starterPrompt?: string | null;
  starterAttachments?: PromptAttachment[] | null;
  /** Mensagem de erro para auto-correção (disparada pelo preview). */
  autoFixError?: string | null;
  onAutoFixHandled?: () => void;
  onAutoFixFailed?: () => void;
  /** Disparado quando o usuário envia um pedido MANUAL (para zerar o orçamento de auto-correções). */
  onUserSend?: () => void;
  onSiteResult: (result: GenerationResult) => void;
  onAppResult: (result: AppGenerationResult) => void | Promise<void>;
  onGeneratingChange?: (generating: boolean) => void;
  /** Informa o modo do motor da última geração (real/template/demo) ao pai. */
  onEngineMode?: (mode: EngineMode | null) => void;
}

const SITE_SUGGESTIONS = [
  "Crie uma landing page para minha cafeteria",
  "Um dashboard de vendas com KPIs e gráfico",
  "Um portfólio de fotografia com galeria",
];
const APP_SUGGESTIONS = [
  "Um app de lista de tarefas com prioridades",
  "Uma calculadora de gorjeta",
  "Um quiz de perguntas e respostas",
];
const REFINE_SITE = ["Mude a cor para azul", "Adicione uma seção de FAQ", "Crie uma página Sobre"];
const REFINE_APP = ["Melhore a experiência de uso", "Adicione validações e feedbacks", "Otimize a versão mobile"];
const REFINE_GAME = ["Adicione um placar", "Crie níveis de dificuldade", "Adicione um botão de reiniciar"];
const REFINE_CODE_SITE = ["Melhore a versão mobile", "Deixe o visual mais premium", "Revise os textos e chamadas"];

function canRetryStagedFailure(error: any): boolean {
  if (error?.name === "AbortError") return false;
  const message = String(error?.message || "").toLowerCase();
  return !/(?:n[aã]o autenticado|chave rejeitada|sem cr[eé]dito|sem saldo|limite de .* gera[çc][oõ]es|muitas gera[çc][oõ]es|project_not_owned|projeto n[aã]o encontrado)/i.test(message);
}

export function ChatPanel({
  projectId,
  threadId,
  initialMessages,
  mode,
  schema,
  code,
  files,
  projectName,
  starterPrompt,
  starterAttachments,
  autoFixError,
  onAutoFixHandled,
  onAutoFixFailed,
  onUserSend,
  onSiteResult,
  onAppResult,
  onGeneratingChange,
  onEngineMode,
}: ChatPanelProps) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<Message[]>(() => {
    // Se o banco trouxe a conversa, usa ela. Se veio vazia (ex.: falha de
    // persistência/RLS), cai no espelho salvo no navegador — assim o histórico
    // NUNCA some ao recarregar a página.
    if (initialMessages && initialMessages.length) return initialMessages;
    try {
      const s = localStorage.getItem(`adstudio:chat:${threadId}`);
      if (s) return JSON.parse(s) as Message[];
    } catch {}
    return initialMessages;
  });
  const recoveredFailureKey = `adstudio:recovered-failures:${threadId}`;
  const [recoveredFailureIds, setRecoveredFailureIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(recoveredFailureKey);
      return raw ? JSON.parse(raw) as string[] : [];
    } catch {
      return [];
    }
  });
  const [recoveryProgress, setRecoveryProgress] = useState<{ current: number; total: number } | null>(null);
  const [input, setInput] = useState(() => {
    // Rascunho: recupera o texto que estava sendo digitado (por thread), pra não
    // sumir se recarregar a página no meio de um pedido.
    try {
      return localStorage.getItem(`adstudio:draft:${threadId}`) || "";
    } catch {
      return "";
    }
  });
  const [generating, setGenerating] = useState(false);
  const [plan, setPlan] = useState<string[]>([]);
  const [planDone, setPlanDone] = useState(0);
  const [lastCost, setLastCost] = useState<number | null>(null);
  const [projectCost, setProjectCost] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const autoFixInFlightRef = useRef<string | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<PromptAttachment[]>([]);
  const [resumeJob, setResumeJob] = useState<StagedBuildJob | null>(null);
  const [stageStatus, setStageStatus] = useState<{ current: number; total: number; label: string } | null>(null);
  const stagedStorageKey = `adstudio:staged-build:${projectId}`;
  const failedRequests = useMemo(
    () => failedRefinementRequests(messages, recoveredFailureIds),
    [messages, recoveredFailureIds]
  );

  // ── Modo de geração de código: REAL (IA escreve) vs TEMPLATE (enlatado/demo) ──
  const [genMode, setGenMode] = useState<GenMode>("real");
  const genModeRef = useRef<GenMode>("real");
  genModeRef.current = genMode;
  const [lastGen, setLastGen] = useState<GenEvidence | null>(null);
  useEffect(() => {
    const s = localStorage.getItem("adstudio:gen-mode");
    if (s === "real" || s === "template") setGenMode(s);
  }, []);

  useEffect(() => {
    let localJob: StagedBuildJob | null = null;
    try {
      const raw = localStorage.getItem(stagedStorageKey);
      const parsed = raw ? JSON.parse(raw) : null;
      if (isValidStagedBuildJob(parsed, projectId, threadId)) {
        localJob = parsed;
        setResumeJob(parsed);
      } else if (raw) localStorage.removeItem(stagedStorageKey);
    } catch {
      localStorage.removeItem(stagedStorageKey);
    }

    let cancelled = false;
    void supabase
      .from("staged_generation_jobs")
      .select("payload")
      .eq("project_id", projectId)
      .eq("thread_id", threadId)
      .eq("status", "active")
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        const cloudJob = data.payload;
        if (!isValidStagedBuildJob(cloudJob, projectId, threadId)) return;
        if (!localJob || cloudJob.nextStage > localJob.nextStage) {
          try { localStorage.setItem(stagedStorageKey, JSON.stringify(cloudJob)); } catch {}
          setResumeJob(cloudJob);
        } else if (localJob.nextStage > cloudJob.nextStage) {
          void supabase.from("staged_generation_jobs").upsert({
            project_id: projectId,
            thread_id: threadId,
            status: "active",
            payload: stagedJobForCloud(localJob),
          }, { onConflict: "project_id" });
        }
      });
    return () => { cancelled = true; };
  }, [projectId, stagedStorageKey, threadId]);

  async function storeStagedJob(job: StagedBuildJob | null): Promise<void> {
    try {
      if (job) localStorage.setItem(stagedStorageKey, JSON.stringify(job));
      else localStorage.removeItem(stagedStorageKey);
    } catch {}
    setResumeJob(job);
    try {
      if (job) {
        await supabase.from("staged_generation_jobs").upsert({
          project_id: projectId,
          thread_id: threadId,
          status: "active",
          payload: stagedJobForCloud(job),
        }, { onConflict: "project_id" });
      } else {
        await supabase.from("staged_generation_jobs")
          .delete()
          .eq("project_id", projectId)
          .eq("thread_id", threadId);
      }
    } catch {
      // Migração ainda não aplicada ou rede indisponível: o cache local mantém
      // exatamente o comportamento anterior e será sincronizado depois.
    }
  }
  function chooseMode(m: GenMode) {
    setGenMode(m);
    localStorage.setItem("adstudio:gen-mode", m);
  }

  // Espelha a conversa no navegador (por thread) a cada mudança — garante que o
  // histórico persista mesmo se o salvamento no banco falhar.
  useEffect(() => {
    try {
      if (messages.length) localStorage.setItem(`adstudio:chat:${threadId}`, JSON.stringify(messages));
    } catch {}
  }, [messages, threadId]);

  // Salva o rascunho do input (por thread) e limpa quando esvazia/envia.
  useEffect(() => {
    try {
      if (input) localStorage.setItem(`adstudio:draft:${threadId}`, input);
      else localStorage.removeItem(`adstudio:draft:${threadId}`);
    } catch {}
  }, [input, threadId]);

  // ── Comando por voz (Web Speech API com diagnóstico de permissão) ──
  const { listening, supported: voiceSupported, toggle: toggleMic } = useSpeechInput({ value: input, onChange: setInput });

  async function addAttachments(fileList: FileList | null) {
    if (!fileList?.length) return;
    const slots = Math.max(0, MAX_PROMPT_ATTACHMENTS - attachments.length);
    if (!slots) {
      toast.error(`Você pode anexar até ${MAX_PROMPT_ATTACHMENTS} arquivos por pedido.`);
      return;
    }
    const selected = Array.from(fileList).slice(0, slots);
    const prepared: PromptAttachment[] = [];
    for (const file of selected) {
      try {
        prepared.push(await preparePromptAttachment(file));
      } catch (error) {
        toast.error(`Não foi possível anexar ${file.name}`, {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    }
    if (prepared.length) {
      setAttachments((current) => {
        let total = current.reduce((sum, item) => sum + attachmentPayloadBytes(item), 0);
        const accepted: PromptAttachment[] = [];
        for (const item of prepared) {
          const bytes = attachmentPayloadBytes(item);
          if (total + bytes > MAX_PROMPT_TOTAL_BYTES) {
            toast.error("Os anexos ficaram grandes demais juntos", { description: "Remova um arquivo ou use referências menores." });
            continue;
          }
          total += bytes;
          accepted.push(item);
        }
        return current.concat(accepted).slice(0, MAX_PROMPT_ATTACHMENTS);
      });
    }
    if (attachmentInputRef.current) attachmentInputRef.current.value = "";
  }

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const schemaRef = useRef(schema);
  schemaRef.current = schema;
  const codeRef = useRef(code);
  codeRef.current = code;
  const filesRef = useRef(files);
  filesRef.current = files;
  // Controla o "parar" de uma geração em andamento (o usuário pode interromper
  // e mandar outro comando). Guardamos o AbortController da requisição atual.
  const abortRef = useRef<AbortController | null>(null);
  function stopGeneration() {
    abortRef.current?.abort();
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, generating, planDone]);

  useEffect(() => {
    if (starterPrompt && !startedRef.current && messages.length === 0) {
      startedRef.current = true;
      send(starterPrompt, false, starterAttachments ?? []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [starterPrompt, starterAttachments]);

  // Auto-correção: ao receber um erro do preview, pede à IA para corrigir.
  useEffect(() => {
    if (!autoFixError || generating) return;
    if (autoFixInFlightRef.current === autoFixError) return;
    autoFixInFlightRef.current = autoFixError;
    const msg = autoFixError.startsWith("⚙️ REPARO CONTROLADO")
      ? autoFixError
      : `⚙️ Correção automática: o app apresentou este erro ao executar:\n"${autoFixError}"\n` +
        `Corrija a CAUSA desse erro nos arquivos atuais e mantenha TODA a funcionalidade. ` +
        `Para arquivo existente, devolva apenas AD_PATCH com AD_SEARCH literal e único + AD_REPLACE. ` +
        `Use AD_FILE somente se precisar criar um arquivo. ` +
        `Erros comuns: importar de 'lucide-react' um ícone que não existe (use 'react-icons' para marcas), ` +
        `variável/props indefinida, .map em algo que ainda não é array (inicialize com []), ou await sem async.`;
    onAutoFixHandled?.();
    void send(msg, true).then((success) => {
      if (!success) onAutoFixFailed?.();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFixError, generating]);

  useEffect(() => {
    if (!autoFixError) autoFixInFlightRef.current = null;
  }, [autoFixError]);

  async function persist(role: "user" | "assistant", content: string) {
    await supabase.from("chat_messages").insert({ thread_id: threadId, role, content });
  }

  async function send(
    text: string,
    isAutoFix = false,
    providedAttachments?: PromptAttachment[],
    resumedJob?: StagedBuildJob,
    isRecovery = false
  ): Promise<boolean> {
    const content = (resumedJob?.originalPrompt ?? text).trim();
    if (!content || generating) return false;
    const requestAttachments = resumedJob
      ? resumedJob.imageAttachments ?? []
      : providedAttachments ?? (isAutoFix ? [] : attachments);
    // Cada pedido MANUAL seu zera o contador de auto-correção — assim cada build
    // ganha um novo orçamento de tentativas (o loop de auto-conserto não trava
    // a sessão inteira). As correções automáticas NÃO zeram (senão seria infinito).
    if (!isAutoFix && !resumedJob) onUserSend?.();

    // Decide o motor desta geração.
    // "Geração real" SEMPRE escreve código React de verdade (inclusive landings),
    // exceto em projetos que já são schema/site (para não sobrescrever o editor visual).
    // "Template/Schema" usa a heurística: app enlatado ou motor de seções.
    const useApp = !!resumedJob ||
      modeRef.current === "app" ||
      (modeRef.current !== "site" && (genModeRef.current === "real" || looksLikeApp(content)));
    const hasCurrentProject = !!(codeRef.current || filesRef.current?.length);
    const useStagedBuild = !isAutoFix && useApp && genModeRef.current === "real" && !!(
      resumedJob ||
      shouldStageInitialBuild(content, requestAttachments, hasCurrentProject) ||
      shouldStageRefinement(content, requestAttachments, hasCurrentProject)
    );

    setInput("");
    if (!isAutoFix && !resumedJob) setAttachments([]);
    const visibleContent = requestAttachments.length
      ? `${content}\n\n📎 ${requestAttachments.map(attachmentLabel).join(" · ")}`
      : content;
    if (!resumedJob && !isRecovery) {
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", content: visibleContent }]);
      persist("user", content);
    }
    setGenerating(true);
    onGeneratingChange?.(true);
    if (!useStagedBuild) {
      setPlan([]);
      setPlanDone(0);
    }

    let activeStagedJob: StagedBuildJob | null = null;
    let activeStageLabel = "";

    try {
      const endpoint = useApp ? "/api/generate-app" : "/api/generate";
      const costMode = localStorage.getItem("nexaform:cost-mode") || "auto";
      const controller = new AbortController();
      abortRef.current = controller;
      const request = async (payload: Record<string, unknown>) => {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        let data: any;
        try { data = await res.json(); }
        catch { throw new Error("O servidor encerrou a resposta antes de concluir esta etapa."); }
        if (!res.ok) throw new Error(data?.error ?? "Falha na geração.");
        return data;
      };
      const appPayload = (
        message: string,
        currentCode: string | null,
        currentFiles: AppFile[] | null,
        stageAttachments: PromptAttachment[],
        requestId: string
      ) => ({
        projectId,
        requestId,
        message,
        currentCode,
        currentFiles,
        name: projectName,
        userKey: localStorage.getItem("nexaform:ai-key") || null,
        userProvider: localStorage.getItem("nexaform:ai-provider") || null,
        costMode,
        forceReal: genModeRef.current === "real",
        allowTemplate: genModeRef.current === "template",
        attachments: stageAttachments,
      });

      if (useStagedBuild) {
        const jobKind = resumedJob?.kind ?? (hasCurrentProject ? "refinement" : "initial");
        const stages = stagedStages(jobKind);
        let job: StagedBuildJob = resumedJob ?? {
          version: STAGED_BUILD_VERSION,
          projectId,
          threadId,
          originalPrompt: content,
          masterPrompt: buildMasterPrompt(content, requestAttachments),
          kind: jobKind,
          imageAttachments: requestAttachments.filter((attachment) => attachment.kind === "image"),
          nextStage: 0,
          startedAt: new Date().toISOString(),
        };
        activeStagedJob = job;
        await storeStagedJob(job);
        setPlan(stages.map((stage, index) => `${index + 1}/${stages.length} · ${stage.label}`));
        setPlanDone(job.nextStage);

        let workingCode = codeRef.current;
        let workingFiles = filesRef.current ?? null;
        let lastData: any = null;
        for (let index = job.nextStage; index < stages.length; index++) {
          const stage = stages[index];
          activeStageLabel = stage.label;
          setStageStatus({ current: index + 1, total: stages.length, label: stage.label });
          const stagePrompt = buildStagePrompt(job.masterPrompt, stage, index, stages.length, jobKind);
          // O texto dos anexos já foi incorporado à especificação mestra. Imagens
          // de referência seguem apenas na primeira etapa para não multiplicar payloads.
          const stageAttachments = index === 0
            ? requestAttachments.filter((attachment) => attachment.kind === "image")
            : [];
          // A mesma etapa reutiliza o identificador na segunda tentativa. Se a
          // conexão cair depois do servidor iniciar, o backend não cobra nem
          // executa duas vezes o mesmo pedido simultaneamente.
          const stageRequestId = crypto.randomUUID();
          let data: any;
          try {
            data = await request(appPayload(stagePrompt, workingCode, workingFiles, stageAttachments, stageRequestId));
          } catch (firstError) {
            if (!canRetryStagedFailure(firstError)) throw firstError;
            setStageStatus({ current: index + 1, total: stages.length, label: `${stage.label} · nova tentativa` });
            const retryPrompt = buildStageRetryPrompt(job.masterPrompt, stage, index, stages.length, jobKind);
            data = await request(appPayload(retryPrompt, workingCode, workingFiles, stageAttachments, stageRequestId));
          }
          lastData = data;

          if (typeof data.cost === "number") setLastCost(data.cost);
          if (typeof data.projectCost === "number") setProjectCost(data.projectCost);
          const evidence: GenEvidence = {
            engineMode: (data.engineMode as EngineMode) ?? "real",
            provider: String(data.provider ?? "?"),
            model: data.model,
            stats: data.stats,
            cost: typeof data.cost === "number" ? data.cost : undefined,
            media: data.media,
          };
          setLastGen(evidence);
          onEngineMode?.(evidence.engineMode);
          await Promise.resolve(onAppResult(data as AppGenerationResult));

          const app = (data as AppGenerationResult).app;
          if (app.files?.length) {
            workingFiles = app.files;
            workingCode = null;
            filesRef.current = app.files;
            codeRef.current = null;
          } else {
            workingCode = app.code ?? null;
            workingFiles = null;
            codeRef.current = workingCode;
            filesRef.current = null;
          }

          job = {
            ...job,
            nextStage: index + 1,
            imageAttachments: index === 0 ? undefined : job.imageAttachments,
          };
          activeStagedJob = job;
          setPlanDone(index + 1);
          await storeStagedJob(job.nextStage < stages.length ? job : null);
        }

        const completion = jobKind === "refinement"
          ? `✅ Refinamento concluído em ${stages.length} etapas, com salvamento após cada uma. ${lastData?.reply ?? "As alterações foram integradas ao projeto."}`
          : `✅ Projeto construído em ${stages.length} etapas, com salvamento após cada uma. ${lastData?.reply ?? "A base funcional está pronta para novos refinamentos."}`;
        setMessages((messages) => [...messages, { id: crypto.randomUUID(), role: "assistant", content: completion }]);
        persist("assistant", completion);
        await storeStagedJob(null);
        return true;
      }

      const payload = useApp
        ? appPayload(content, codeRef.current, filesRef.current ?? null, requestAttachments, crypto.randomUUID())
        : {
            projectId,
            requestId: crypto.randomUUID(),
            message: content,
            schema: schemaRef.current,
            userKey: localStorage.getItem("nexaform:ai-key") || null,
            userProvider: localStorage.getItem("nexaform:ai-provider") || null,
            costMode,
          };
      const data = await request(payload);

      const steps: string[] = Array.isArray(data.plan) ? data.plan : [];
      setPlan(steps);
      for (let i = 0; i <= steps.length; i++) {
        await new Promise((r) => setTimeout(r, 320));
        setPlanDone(i);
      }

      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", content: data.reply }]);
      persist("assistant", data.reply);

      if (typeof data.cost === "number") setLastCost(data.cost);
      if (typeof data.projectCost === "number") setProjectCost(data.projectCost);

      if (useApp) {
        const ev: GenEvidence = {
          engineMode: (data.engineMode as EngineMode) ?? "real",
          provider: String(data.provider ?? "?"),
          model: data.model,
          stats: data.stats,
          cost: typeof data.cost === "number" ? data.cost : undefined,
          media: data.media,
        };
        setLastGen(ev);
        onEngineMode?.(ev.engineMode);
        await Promise.resolve(onAppResult(data as AppGenerationResult));
      } else {
        // Modo site = motor de schema/seções (não é geração de código real).
        setLastGen({ engineMode: "template", provider: "schema" });
        onEngineMode?.("template");
        onSiteResult(data as GenerationResult);
      }
      return true;
    } catch (err: any) {
      if (activeStagedJob) {
        await storeStagedJob(activeStagedJob);
        const current = Math.min(activeStagedJob.nextStage + 1, stagedStages(activeStagedJob.kind ?? "initial").length);
        const paused = err?.name === "AbortError"
          ? `⏸️ Construção pausada antes da etapa ${current}. Todo o progresso anterior foi salvo.`
          : `A construção parou na etapa ${current} (${activeStageLabel || "continuação"}), mas todo o progresso anterior foi salvo. Clique em “Continuar construção” para retomar deste ponto. Motivo: ${err?.message ?? "falha temporária"}`;
        if (err?.name === "AbortError") toast("Construção pausada com segurança.");
        else toast.error("Etapa não concluída", { description: "O progresso anterior foi preservado." });
        setMessages((messages) => [...messages, { id: crypto.randomUUID(), role: "assistant", content: paused }]);
        persist("assistant", paused);
        return false;
      }
      // Interrompido pelo usuário (botão parar): não é erro, apenas devolve o controle.
      if (err?.name === "AbortError") {
        toast("Geração interrompida.");
        setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", content: "⏹️ Interrompido. Pode mandar outro comando." }]);
      } else {
        const msg = err?.message ?? "Algo deu errado.";
        if (isAutoFix) {
          const notice =
            `⚠️ A alteração principal e o projeto salvo foram preservados. ` +
            `A verificação automática do preview não conseguiu produzir uma correção adicional: ${msg}`;
          toast.error("Verificação automática não concluída", {
            description: "A alteração principal foi preservada; não desfiz nem substituí o projeto.",
          });
          setMessages((messages) => [...messages, { id: crypto.randomUUID(), role: "assistant", content: notice }]);
          persist("assistant", notice);
          return false;
        }
        toast.error("Geração falhou", { description: msg });
        setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", content: `Ops — ${msg}` }]);
      }
      return false;
    } finally {
      abortRef.current = null;
      setGenerating(false);
      onGeneratingChange?.(false);
      setStageStatus(null);
      setPlan([]);
      setPlanDone(0);
    }
  }

  async function recoverFailedRefinements(): Promise<void> {
    if (generating || recoveryProgress || !failedRequests.length) return;
    const requests = failedRequests.slice();
    let recovered = recoveredFailureIds.slice();
    setRecoveryProgress({ current: 0, total: requests.length });
    for (let index = 0; index < requests.length; index++) {
      setRecoveryProgress({ current: index + 1, total: requests.length });
      const success = await send(requests[index].prompt, false, [], undefined, true);
      if (!success) {
        toast.error("Recuperação pausada", {
          description: `As ${index} alterações anteriores foram salvas. A próxima continua pendente.`,
        });
        break;
      }
      recovered = recovered.concat(requests[index].messageId);
      setRecoveredFailureIds(recovered);
      try { localStorage.setItem(recoveredFailureKey, JSON.stringify(recovered)); } catch {}
    }
    setRecoveryProgress(null);
  }

  const lastUserRequest = [...messages]
    .reverse()
    .find((message) => message.role === "user" && !message.content.startsWith("⚙️ Correção automática:"))?.content ?? "";
  const describesContentSite = /\b(site|landing|p[áa]gina|portf[oó]lio|empresa|ag[êe]ncia|cl[ií]nica|cafeteria|restaurante|advocacia)\b/i.test(lastUserRequest);
  const describesGame = /\b(jogo|game|quiz|xadrez|dama|sudoku|snake|cobrinha|2048|mem[oó]ria|forca|wordle|termo)\b/i.test(lastUserRequest);
  const suggestions =
    mode === "app"
      ? describesContentSite ? REFINE_CODE_SITE : describesGame ? REFINE_GAME : REFINE_APP
      : mode === "site" ? REFINE_SITE : [...APP_SUGGESTIONS.slice(0, 2), SITE_SUGGESTIONS[0]];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-xs font-medium">
          {mode === "app" ? <Code2 className="h-3 w-3" /> : mode === "site" ? <Layout className="h-3 w-3" /> : null}
          Construtor
        </span>
        <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {projectCost !== null && (
            <span className="rounded-full bg-secondary px-1.5 py-0.5 tabular-nums" title="Custo acumulado deste projeto">
              ${projectCost.toFixed(3)}
            </span>
          )}
          <span className={cn("h-1.5 w-1.5 rounded-full", generating ? "animate-pulse-soft bg-brand-500" : "bg-emerald-500")} />
          {stageStatus
            ? `Etapa ${stageStatus.current}/${stageStatus.total} · ${stageStatus.label}`
            : generating ? "Construindo…" : "Pronto"}
        </span>
      </div>

      {/* Seletor de modo do motor — deixa explícito real vs template/demo */}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <span className="text-[11px] font-medium text-muted-foreground">Motor:</span>
        <div className="inline-flex rounded-lg border p-0.5">
          <button
            type="button"
            onClick={() => chooseMode("real")}
            title="A IA escreve código React de verdade a partir do seu pedido"
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
              genMode === "real" ? "bg-emerald-500 text-white" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Cpu className="h-3 w-3" /> Geração real
          </button>
          <button
            type="button"
            onClick={() => chooseMode("template")}
            title="Permite template pronto / demo quando não houver IA — nunca vendido como geração real"
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
              genMode === "template" ? "bg-amber-500 text-white" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Layout className="h-3 w-3" /> Template/Demo
          </button>
        </div>
      </div>

      {/* Barra de evidências da última geração — prova técnica do modo */}
      {lastGen && (
        <div
          className={cn(
            "flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-[11px]",
            lastGen.engineMode === "real"
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : lastGen.engineMode === "template"
              ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
              : "bg-red-500/10 text-red-700 dark:text-red-300"
          )}
        >
          <span className="flex items-center gap-1 font-semibold">
            {lastGen.engineMode === "real" ? (
              <>
                <Cpu className="h-3 w-3" /> GERAÇÃO REAL
              </>
            ) : lastGen.engineMode === "template" ? (
              <>
                <Layout className="h-3 w-3" /> TEMPLATE/SCHEMA
              </>
            ) : (
              <>
                <AlertTriangle className="h-3 w-3" /> MODO DEMO
              </>
            )}
          </span>
          <span className="opacity-80">
            {lastGen.provider}
            {lastGen.model && lastGen.model !== "template" && lastGen.model !== "demo" ? ` · ${lastGen.model}` : ""}
          </span>
          {lastGen.stats && (
            <span className="flex items-center gap-1 opacity-80">
              <FileCode2 className="h-3 w-3" />
              {lastGen.stats.files > 1 ? `${lastGen.stats.files} arquivos · ` : ""}
              {lastGen.stats.lines} linhas · {lastGen.stats.components} comp. · {lastGen.stats.hooks} hooks ·{" "}
              {lastGen.stats.handlers} eventos
            </span>
          )}
          {lastGen.media && (lastGen.media.requested > 0 || lastGen.media.reused > 0 || lastGen.media.videoAssetsAvailable > 0) && (
            <span className="flex items-center gap-1 opacity-80" title={`${lastGen.media.fallbacks} fallback(s), ${lastGen.media.unresolved} pendência(s)`}>
              <ImageIcon className="h-3 w-3" />
              mídia: {lastGen.media.generated} gerada · {lastGen.media.reused} reutilizada
            </span>
          )}
          {typeof lastGen.cost === "number" && lastGen.cost > 0 && (
            <span className="tabular-nums opacity-80">${lastGen.cost.toFixed(4)}</span>
          )}
        </div>
      )}

      <div className="flex-1 space-y-4 overflow-y-auto p-4 scrollbar-thin">
        {messages.length === 0 && !generating && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-gradient text-white">
              <Sparkles className="h-4 w-4" />
            </div>
            <p className="text-sm font-medium">O que vamos construir?</p>
            <p className="mt-1 max-w-[240px] text-xs text-muted-foreground">
              Descreva um app funcional (jogo, ferramenta, calculadora) ou um site — eu escrevo e executo o código.
            </p>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm",
                m.role === "user" ? "bg-brand-gradient text-white" : "bg-secondary text-secondary-foreground"
              )}
            >
              {m.content}
            </div>
          </div>
        ))}

        {generating && (
          <div className="max-w-[85%] space-y-2 rounded-xl bg-secondary p-3.5">
            {plan.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                Escrevendo o código…
              </div>
            ) : (
              plan.map((step, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-start gap-2 text-xs transition-opacity",
                    i < planDone ? "text-foreground" : i === planDone ? "text-muted-foreground" : "opacity-40"
                  )}
                >
                  {i < planDone ? (
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  ) : i === planDone ? (
                    <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                  ) : (
                    <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border" />
                  )}
                  {step}
                </div>
              ))
            )}
          </div>
        )}
        {!generating && resumeJob && (
          <div className="space-y-3 rounded-xl border border-brand-500/30 bg-brand-500/10 p-3.5">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
              <div>
                <p className="text-sm font-medium">Construção por etapas pausada</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  As etapas anteriores estão salvas. A próxima é {resumeJob.nextStage + 1} de {stagedStages(resumeJob.kind ?? "initial").length}.
                </p>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="brand"
              className="w-full"
              onClick={() => send(resumeJob.originalPrompt, false, [], resumeJob)}
            >
              Continuar construção
            </Button>
          </div>
        )}
        {!generating && !resumeJob && failedRequests.length > 0 && (
          <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div>
                <p className="text-sm font-medium">
                  {failedRequests.length} {failedRequests.length === 1 ? "alteração pendente" : "alterações pendentes"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  O histórico mostra pedidos que não foram aplicados. O AD Studio pode refazê-los um por vez, salvando cada resultado antes de continuar.
                </p>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="brand"
              className="w-full"
              onClick={recoverFailedRefinements}
              disabled={!!recoveryProgress}
            >
              {recoveryProgress
                ? `Recuperando ${recoveryProgress.current}/${recoveryProgress.total}…`
                : `Recuperar ${failedRequests.length === 1 ? "alteração" : `${failedRequests.length} alterações`}`}
            </Button>
            <p className="text-[10px] text-muted-foreground">
              Usa o provedor de IA configurado. Nenhum pedido é agrupado ou descartado.
            </p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {!generating && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-2">
          {suggestions.slice(0, 3).map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-brand-500/60 hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="border-t p-3"
      >
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((attachment) => (
              <span key={attachment.id} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-secondary/60 px-2 py-1 text-[11px]">
                {attachment.kind === "image" ? <ImageIcon className="h-3 w-3 shrink-0" /> : <FileCode2 className="h-3 w-3 shrink-0" />}
                <span className="max-w-48 truncate">{attachment.name}</span>
                <button
                  type="button"
                  onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                  className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                  aria-label={`Remover ${attachment.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-xl border bg-card p-2 focus-within:ring-1 focus-within:ring-ring">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={
              listening
                ? "Ouvindo… fale o que você quer construir"
                : mode === "empty"
                ? "Descreva ou dite o app/site que você quer…"
                : "Peça um refinamento (ou use o microfone)…"
            }
            rows={2}
            className="min-h-0 resize-none border-0 shadow-none focus-visible:ring-0"
            disabled={generating}
          />
          <input
            ref={attachmentInputRef}
            type="file"
            multiple
            accept={PROMPT_ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={(event) => addAttachments(event.target.files)}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => attachmentInputRef.current?.click()}
            disabled={generating || attachments.length >= MAX_PROMPT_ATTACHMENTS}
            aria-label="Anexar arquivo do computador"
            title="Anexar imagem, texto ou código"
          >
            <Paperclip />
          </Button>
          <Button
            type="button"
            size="icon"
            variant={listening ? "brand" : "ghost"}
            onClick={toggleMic}
            disabled={generating}
            aria-label={listening ? "Parar de ouvir" : "Ditar por voz"}
            title={voiceSupported === false ? "Ditado indisponível neste navegador" : listening ? "Parar" : "Ditar por voz"}
            className={listening ? "animate-pulse-soft" : ""}
          >
            {listening ? <Square /> : <Mic />}
          </Button>
          {generating ? (
            <Button
              type="button"
              size="icon"
              variant="destructive"
              onClick={stopGeneration}
              aria-label="Parar geração"
              title="Parar"
              className="animate-pulse-soft"
            >
              <Square />
            </Button>
          ) : (
            <Button type="submit" size="icon" variant="brand" disabled={!input.trim()} aria-label="Enviar">
              <ArrowUp />
            </Button>
          )}
        </div>
        <p className="mt-1.5 px-1 text-[10px] text-muted-foreground">
          <kbd className="rounded border px-1">⏎</kbd> envia · <kbd className="rounded border px-1">⇧⏎</kbd> quebra linha
          {voiceSupported ? " · 🎙 fale pelo microfone" : ""} · <Paperclip className="inline h-3 w-3" /> anexe imagem, texto ou código
        </p>
      </form>
    </div>
  );
}
