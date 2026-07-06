"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowUp, Check, Loader2, Sparkles, Code2, Layout, Mic, Square } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AppSchema, GenerationResult } from "@/lib/engine/types";
import { AppGenerationResult, looksLikeApp } from "@/lib/engine/app-types";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export type ProjectMode = "empty" | "site" | "app";

interface ChatPanelProps {
  projectId: string;
  threadId: string;
  initialMessages: Message[];
  mode: ProjectMode;
  schema: AppSchema | null;
  code: string | null;
  projectName: string;
  starterPrompt?: string | null;
  /** Mensagem de erro para auto-correção (disparada pelo preview). */
  autoFixError?: string | null;
  onAutoFixHandled?: () => void;
  onSiteResult: (result: GenerationResult) => void;
  onAppResult: (result: AppGenerationResult) => void;
  onGeneratingChange?: (generating: boolean) => void;
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
const REFINE_APP = ["Adicione um placar", "Deixe o tema escuro", "Adicione um botão de reiniciar"];

export function ChatPanel({
  projectId,
  threadId,
  initialMessages,
  mode,
  schema,
  code,
  projectName,
  starterPrompt,
  autoFixError,
  onAutoFixHandled,
  onSiteResult,
  onAppResult,
  onGeneratingChange,
}: ChatPanelProps) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [plan, setPlan] = useState<string[]>([]);
  const [planDone, setPlanDone] = useState(0);
  const [lastCost, setLastCost] = useState<number | null>(null);
  const [projectCost, setProjectCost] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  // ── Comando por voz (Web Speech API — grátis, roda no navegador) ──
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recRef = useRef<any>(null);
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setVoiceSupported(!!SR);
  }, []);
  function toggleMic() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error("Seu navegador não suporta ditado por voz", { description: "Use o Chrome para o comando de voz." });
      return;
    }
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new SR();
    rec.lang = "pt-BR";
    rec.interimResults = true;
    rec.continuous = false;
    const base = input ? input.trim() + " " : "";
    rec.onresult = (e: any) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      setInput(base + t);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const schemaRef = useRef(schema);
  schemaRef.current = schema;
  const codeRef = useRef(code);
  codeRef.current = code;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, generating, planDone]);

  useEffect(() => {
    if (starterPrompt && !startedRef.current && messages.length === 0) {
      startedRef.current = true;
      send(starterPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [starterPrompt]);

  // Auto-correção: ao receber um erro do preview, pede à IA para corrigir.
  useEffect(() => {
    if (!autoFixError || generating) return;
    const msg = `⚙️ Correção automática: o app apresentou este erro ao executar:\n"${autoFixError}"\nReescreva o componente App corrigindo esse erro e mantendo toda a funcionalidade.`;
    onAutoFixHandled?.();
    send(msg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFixError]);

  async function persist(role: "user" | "assistant", content: string) {
    await supabase.from("chat_messages").insert({ thread_id: threadId, role, content });
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || generating) return;

    // Decide o modo desta geração
    const useApp = modeRef.current === "app" || (modeRef.current === "empty" && looksLikeApp(content));

    setInput("");
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", content }]);
    setGenerating(true);
    onGeneratingChange?.(true);
    setPlan([]);
    setPlanDone(0);
    persist("user", content);

    try {
      const endpoint = useApp ? "/api/generate-app" : "/api/generate";
      const costMode = localStorage.getItem("nexaform:cost-mode") || "auto";
      const payload = useApp
        ? {
            projectId,
            message: content,
            currentCode: codeRef.current,
            name: projectName,
            userKey: localStorage.getItem("nexaform:ai-key") || null,
            userProvider: localStorage.getItem("nexaform:ai-provider") || null,
            costMode,
          }
        : {
            projectId,
            message: content,
            schema: schemaRef.current,
            userKey: localStorage.getItem("nexaform:ai-key") || null,
            userProvider: localStorage.getItem("nexaform:ai-provider") || null,
            costMode,
          };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Falha na geração.");

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

      if (useApp) onAppResult(data as AppGenerationResult);
      else onSiteResult(data as GenerationResult);
    } catch (err: any) {
      const msg = err?.message ?? "Algo deu errado.";
      toast.error("Geração falhou", { description: msg });
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", content: `Ops — ${msg}` }]);
    } finally {
      setGenerating(false);
      onGeneratingChange?.(false);
      setPlan([]);
      setPlanDone(0);
    }
  }

  const suggestions =
    mode === "app" ? REFINE_APP : mode === "site" ? REFINE_SITE : [...APP_SUGGESTIONS.slice(0, 2), SITE_SUGGESTIONS[0]];

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
          {generating ? "Construindo…" : "Pronto"}
        </span>
      </div>

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
          {voiceSupported && (
            <Button
              type="button"
              size="icon"
              variant={listening ? "brand" : "ghost"}
              onClick={toggleMic}
              disabled={generating}
              aria-label={listening ? "Parar de ouvir" : "Ditar por voz"}
              title={listening ? "Parar" : "Ditar por voz"}
              className={listening ? "animate-pulse-soft" : ""}
            >
              {listening ? <Square /> : <Mic />}
            </Button>
          )}
          <Button type="submit" size="icon" variant="brand" disabled={generating || !input.trim()} aria-label="Enviar">
            {generating ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        </div>
        <p className="mt-1.5 px-1 text-[10px] text-muted-foreground">
          <kbd className="rounded border px-1">⏎</kbd> envia · <kbd className="rounded border px-1">⇧⏎</kbd> quebra linha
          {voiceSupported ? " · 🎙 fale pelo microfone" : ""}
        </p>
      </form>
    </div>
  );
}
