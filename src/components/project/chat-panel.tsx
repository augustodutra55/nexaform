"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowUp, Check, Loader2, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AppSchema, GenerationResult } from "@/lib/engine/types";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface ChatPanelProps {
  projectId: string;
  threadId: string;
  initialMessages: Message[];
  schema: AppSchema | null;
  starterPrompt?: string | null;
  onResult: (result: GenerationResult) => void;
  onGeneratingChange?: (generating: boolean) => void;
}

const SUGGESTIONS = [
  "Crie uma landing page para minha cafeteria",
  "Quero um dashboard de vendas com KPIs e gráfico",
  "Monte um portfólio de fotografia com galeria",
  "Crie um site para meu SaaS com planos e FAQ",
];

const REFINE_SUGGESTIONS = [
  "Mude a cor para azul",
  "Adicione uma seção de FAQ",
  "Crie uma página Sobre",
  "Mude para modo claro",
];

export function ChatPanel({
  projectId,
  threadId,
  initialMessages,
  schema,
  starterPrompt,
  onResult,
  onGeneratingChange,
}: ChatPanelProps) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [plan, setPlan] = useState<string[]>([]);
  const [planDone, setPlanDone] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const schemaRef = useRef(schema);
  schemaRef.current = schema;
  const startedRef = useRef(false);

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

  async function persist(role: "user" | "assistant", content: string) {
    await supabase.from("chat_messages").insert({ thread_id: threadId, role, content });
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || generating) return;

    setInput("");
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", content }]);
    setGenerating(true);
    onGeneratingChange?.(true);
    setPlan([]);
    setPlanDone(0);
    persist("user", content);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          message: content,
          schema: schemaRef.current,
          userKey: localStorage.getItem("nexaform:ai-key") || null,
          userProvider: localStorage.getItem("nexaform:ai-provider") || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? "Falha na geração.");
      }

      const result = data as GenerationResult;

      // Progresso visual: revela os passos do plano um a um
      setPlan(result.plan);
      for (let i = 0; i <= result.plan.length; i++) {
        await new Promise((r) => setTimeout(r, 350));
        setPlanDone(i);
      }

      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", content: result.reply }]);
      persist("assistant", result.reply);
      onResult(result);
    } catch (err: any) {
      const msg = err?.message ?? "Algo deu errado. Tente novamente.";
      toast.error("Geração falhou", { description: msg });
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "assistant", content: `Ops — ${msg}` },
      ]);
    } finally {
      setGenerating(false);
      onGeneratingChange?.(false);
      setPlan([]);
      setPlanDone(0);
    }
  }

  const suggestions = schema ? REFINE_SUGGESTIONS : SUGGESTIONS;

  return (
    <div className="flex h-full flex-col">
      {/* Status do construtor — sempre visível */}
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <span className="text-xs font-medium">Construtor</span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              generating ? "animate-pulse-soft bg-brand-500" : "bg-emerald-500"
            )}
          />
          {generating ? "Construindo…" : "Pronto para iterar"}
        </span>
      </div>

      {/* Histórico */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4 scrollbar-thin">
        {messages.length === 0 && !generating && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-gradient text-white">
              <Sparkles className="h-4 w-4" />
            </div>
            <p className="text-sm font-medium">O que vamos construir hoje?</p>
            <p className="mt-1 max-w-[220px] text-xs text-muted-foreground">
              Descreva seu app, site ou dashboard — eu cuido da estrutura e do visual.
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

        {/* Progresso da geração */}
        {generating && (
          <div className="max-w-[85%] space-y-2 rounded-xl bg-secondary p-3.5">
            {plan.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                Interpretando seu pedido…
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

      {/* Sugestões rápidas */}
      {!generating && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-2">
          {suggestions.slice(0, 3).map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
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
            placeholder={schema ? "Peça um refinamento…" : "Descreva o que você quer construir…"}
            rows={2}
            className="min-h-0 resize-none border-0 shadow-none focus-visible:ring-0"
            disabled={generating}
          />
          <Button type="submit" size="icon" variant="brand" disabled={generating || !input.trim()} aria-label="Enviar">
            {generating ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        </div>
        <p className="mt-1.5 px-1 text-[10px] text-muted-foreground">
          <kbd className="rounded border px-1">⏎</kbd> envia · <kbd className="rounded border px-1">⇧⏎</kbd> quebra linha
        </p>
      </form>
    </div>
  );
}
