"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ListChecks, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { PlanPhase, ProjectPlanView } from "@/lib/engine/plan-agent";

/**
 * Plano Auto (Fase 5 — espelha "Build with plan" do Lovable).
 *
 * Ao editar o prompt, cria um plano em /api/plan/[projectId] (POST prompt) e
 * lista as fases (buildPlanPhases). O usuário aprova ("Comitar plano") antes de
 * a geração começar — a aprovação chama a ação approve e dispara onCommit, que
 * o pai liga à geração por etapas (Fase 3+). Nada é gerado sem aprovação.
 */

interface PlanCardProps {
  projectId: string;
  /** Prompt atual do compositor; ao mudar, um novo plano é montado (debounce). */
  prompt: string;
  /** Chamado após aprovar o plano — o pai inicia a construção com este prompt. */
  onCommit: (plan: ProjectPlanView) => void;
  /** Fechar o cartão sem aprovar. */
  onDismiss?: () => void;
}

export function PlanCard({ projectId, prompt, onCommit, onDismiss }: PlanCardProps) {
  const [view, setView] = useState<ProjectPlanView | null>(null);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const lastPromptRef = useRef<string>("");

  // Monta o plano ao estabilizar o prompt (debounce curto para aparecer ≤5s).
  useEffect(() => {
    const clean = prompt.trim();
    if (clean.length < 8 || clean === lastPromptRef.current) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/plan/${encodeURIComponent(projectId)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: clean }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || "Não foi possível montar o plano.");
        if (!cancelled && data?.view) {
          lastPromptRef.current = clean;
          setView(data.view as ProjectPlanView);
        }
      } catch (error) {
        if (!cancelled) toast.error("Plano não gerado", { description: error instanceof Error ? error.message : undefined });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [prompt, projectId]);

  async function commit() {
    if (!view) return;
    setCommitting(true);
    try {
      const res = await fetch(`/api/plan/${encodeURIComponent(projectId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId: view.id, action: "approve" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Não foi possível aprovar o plano.");
      const approved = (data?.view as ProjectPlanView) ?? { ...view, status: "approved" as const };
      setView(approved);
      onCommit(approved);
      toast.success("Plano aprovado", { description: "A construção vai seguir exatamente estas fases." });
    } catch (error) {
      toast.error("Aprovação falhou", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setCommitting(false);
    }
  }

  if (!loading && !view) return null;

  return (
    <div className="space-y-3 rounded-xl border border-brand-500/30 bg-brand-500/10 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
          <div>
            <p className="text-sm font-medium">Plano automático</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Revise as fases e aprove antes de a construção começar.
            </p>
          </div>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Fechar plano"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {loading && !view ? (
        <div className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> Montando o plano…
        </div>
      ) : view ? (
        <>
          <ol className="space-y-1.5">
            {view.phases.map((phase: PlanPhase, index) => (
              <li key={phase.id} className="flex items-start gap-2 rounded-md bg-background/50 px-2 py-1.5 text-xs">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-[10px] font-semibold text-brand-600 dark:text-brand-300">
                  {index + 1}
                </span>
                <span>
                  <span className="font-medium text-foreground">{phase.title}</span>
                  <span className="text-muted-foreground"> · {phase.detail}</span>
                </span>
              </li>
            ))}
          </ol>
          {view.status === "approved" ? (
            <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> Plano aprovado — construção liberada.
            </p>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="brand"
              className="w-full gap-1.5"
              onClick={commit}
              disabled={committing}
            >
              {committing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListChecks className="h-3.5 w-3.5" />}
              {committing ? "Aprovando…" : "Comitar plano"}
            </Button>
          )}
        </>
      ) : null}
    </div>
  );
}
