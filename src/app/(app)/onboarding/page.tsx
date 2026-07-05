"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const goals = [
  { id: "landing", label: "Landing page", desc: "Apresentar um produto ou serviço" },
  { id: "app", label: "App / SaaS", desc: "Uma aplicação completa com telas" },
  { id: "dashboard", label: "Dashboard", desc: "Métricas, tabelas e relatórios" },
  { id: "portfolio", label: "Portfólio", desc: "Mostrar trabalhos e projetos" },
];

const starters = [
  "Crie uma landing page para minha cafeteria com preços e FAQ",
  "Quero um dashboard de vendas com KPIs, gráfico e tabela",
  "Monte um portfólio de fotografia com galeria e contato",
  "Crie um site para meu SaaS de agendamento com planos",
];

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleStart() {
    if (!prompt.trim()) {
      toast.error("Descreva o que você quer construir");
      return;
    }
    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("projects")
      .insert({
        user_id: userData.user!.id,
        name: prompt.slice(0, 48),
        description: prompt.slice(0, 240),
        schema: null,
      })
      .select("id")
      .single();
    setBusy(false);
    if (error || !data) {
      toast.error("Não foi possível criar o projeto");
      return;
    }
    // O prompt inicial segue para a tela do projeto via sessionStorage
    sessionStorage.setItem(`nexaform:starter:${data.id}`, prompt);
    router.push(`/projeto/${data.id}`);
  }

  return (
    <div className="container flex max-w-2xl flex-col items-center py-16">
      <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-gradient text-white glow-brand">
        <Sparkles className="h-5 w-5" />
      </div>
      <h1 className="text-center text-2xl font-bold tracking-tight">
        {step === 0 ? "O que você quer construir primeiro?" : "Descreva com suas palavras"}
      </h1>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        {step === 0
          ? "Isso nos ajuda a preparar boas sugestões. Você pode mudar depois."
          : "Quanto mais contexto, melhor a primeira versão. Ou escolha um exemplo."}
      </p>

      {step === 0 ? (
        <>
          <div className="mt-8 grid w-full gap-3 sm:grid-cols-2">
            {goals.map((g) => (
              <button
                key={g.id}
                onClick={() => setGoal(g.id)}
                className={cn(
                  "rounded-xl border bg-card p-5 text-left transition-all hover:border-primary/60",
                  goal === g.id && "border-primary ring-1 ring-primary"
                )}
              >
                <p className="font-medium">{g.label}</p>
                <p className="mt-1 text-sm text-muted-foreground">{g.desc}</p>
              </button>
            ))}
          </div>
          <div className="mt-8 flex w-full justify-between">
            <Button variant="ghost" onClick={() => router.push("/dashboard")}>
              Pular por agora
            </Button>
            <Button variant="brand" disabled={!goal} onClick={() => setStep(1)}>
              Continuar <ArrowRight />
            </Button>
          </div>
        </>
      ) : (
        <>
          <Card className="mt-8 w-full">
            <CardContent className="pt-6">
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                placeholder="Ex.: Crie uma landing page para meu estúdio de yoga, com horários, planos e depoimentos, em tons de verde…"
                autoFocus
              />
              <div className="mt-4 flex flex-wrap gap-2">
                {starters.map((s) => (
                  <button
                    key={s}
                    onClick={() => setPrompt(s)}
                    className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
          <div className="mt-8 flex w-full justify-between">
            <Button variant="ghost" onClick={() => setStep(0)}>
              Voltar
            </Button>
            <Button variant="brand" onClick={handleStart} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Criar meu projeto
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
