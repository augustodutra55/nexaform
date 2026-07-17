"use client";

import { AlertTriangle, CheckCircle2, ClipboardCheck, Clock3, ShieldAlert } from "lucide-react";
import type { AppCode } from "@/lib/engine/app-types";
import type { ProjectAcceptanceSnapshot } from "@/lib/studio";
import { buildAcceptanceReport, type AcceptanceStatus } from "@/lib/engine/acceptance-report";
import { cn } from "@/lib/utils";

interface AcceptancePanelProps {
  app: AppCode | null;
  acceptance?: ProjectAcceptanceSnapshot;
  previewHealth: "checking" | "healthy" | "error";
}

const statusCopy = {
  ready: { label: "Pronto para publicar", detail: "As verificações automáticas foram aprovadas.", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  review: { label: "Pronto com ressalvas", detail: "O app funciona, mas vale revisar os avisos antes da entrega.", className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  blocked: { label: "Publicação bloqueada", detail: "Existe uma falha real que precisa ser corrigida.", className: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300" },
  checking: { label: "Verificação em andamento", detail: "Aguarde o teste automático de desktop e mobile.", className: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300" },
};

function ItemIcon({ status }: { status: AcceptanceStatus }) {
  if (status === "passed") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "blocked") return <ShieldAlert className="h-4 w-4 text-red-500" />;
  if (status === "pending") return <Clock3 className="h-4 w-4 text-blue-500" />;
  return <AlertTriangle className="h-4 w-4 text-amber-500" />;
}

export function AcceptancePanel({ app, acceptance, previewHealth }: AcceptancePanelProps) {
  const report = buildAcceptanceReport({
    app,
    plan: acceptance?.plan,
    structural: acceptance?.structural,
    runtime: acceptance?.runtime,
    previewHealth,
  });
  const copy = statusCopy[report.status];

  return (
    <div className="h-full overflow-y-auto bg-muted/20 p-4">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-brand-500" />
              <h2 className="font-semibold">Centro de Qualidade</h2>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Compara o código aprovado com o contrato do pedido e com o preview real em desktop e mobile.
            </p>
          </div>
          <div className={cn("rounded-xl border px-4 py-3", copy.className)}>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold tabular-nums">{report.score}</span>
              <div>
                <p className="text-sm font-semibold">{copy.label}</p>
                <p className="text-xs opacity-80">{copy.detail}</p>
              </div>
            </div>
          </div>
        </div>

        {acceptance?.plan ? (
          <section className="rounded-xl border bg-background p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-500">Contrato do pedido</p>
                <h3 className="mt-1 text-base font-semibold">{acceptance.plan.objective}</h3>
              </div>
              <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium">{acceptance.plan.visualProfile.label}</span>
            </div>
            <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
              <div><span className="text-muted-foreground">Público:</span> {acceptance.plan.audience}</div>
              <div><span className="text-muted-foreground">Direção:</span> {acceptance.plan.visualDirection.join("; ")}</div>
            </div>
          </section>
        ) : (
          <section className="rounded-xl border border-dashed bg-background p-4 text-sm text-muted-foreground">
            Este projeto foi criado antes do contrato de geração. A próxima geração completa registrará o pedido; o preview continua sendo testado normalmente.
          </section>
        )}

        <section className="overflow-hidden rounded-xl border bg-background">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-sm font-semibold">Checklist de aceite</h3>
            <span className="text-xs text-muted-foreground">{report.blockers} bloqueio(s) · {report.warnings} aviso(s)</span>
          </div>
          <div className="divide-y">
            {report.items.map((item) => (
              <div key={item.id} className="flex gap-3 px-4 py-3">
                <div className="mt-0.5 shrink-0"><ItemIcon status={item.status} /></div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <p className="text-xs text-muted-foreground">
          O bloqueio automático é reservado a falhas comprovadas de estrutura, execução ou responsividade. Avisos não impedem a publicação.
        </p>
      </div>
    </div>
  );
}
