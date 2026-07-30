"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Award, CheckCircle2, Loader2, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReadinessReport, ReadinessStatus } from "@/lib/system/readiness";
import { cn } from "@/lib/utils";

const statusIcon: Record<ReadinessStatus, typeof CheckCircle2> = {
  ready: CheckCircle2,
  warning: AlertTriangle,
  blocked: XCircle,
};

export function SystemReadinessCard() {
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/system/readiness", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Não foi possível verificar o ambiente.");
      setReport(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível verificar o ambiente.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Saúde do AD Studio
            </CardTitle>
            <CardDescription>
              Verificação real do banco, segurança, mídia, retomada e serviços do ambiente.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Verificar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && !report && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Conferindo o ambiente de produção…
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        {report && (
          <>
            <div className={cn(
              "rounded-xl border p-5",
              report.release.certified
                ? "border-emerald-500/40 bg-emerald-500/10"
                : "border-amber-500/30 bg-amber-500/5"
            )}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="flex items-center gap-2 font-semibold">
                    <Award className="h-5 w-5" />
                    {report.release.certified ? "AD Studio certificado 12/12" : "Certificação de produção"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {report.release.certified
                      ? "As 12 capacidades essenciais estão implementadas e o ambiente está operacional."
                      : `${report.release.ready} de 12 capacidades estão comprovadamente prontas. Os bloqueios aparecem abaixo.`}
                  </p>
                </div>
                <div className="rounded-lg border bg-background px-3 py-2 text-right">
                  <p className="text-2xl font-bold">{report.release.score}%</p>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">produção</p>
                </div>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {report.release.gates.map((gate) => {
                const Icon = statusIcon[gate.status];
                return (
                  <div key={gate.id} className="rounded-xl border p-3">
                    <div className="flex items-start gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                        {gate.number}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-sm font-medium">
                          <Icon className={cn(
                            "h-3.5 w-3.5",
                            gate.status === "ready" && "text-emerald-500",
                            gate.status === "warning" && "text-amber-500",
                            gate.status === "blocked" && "text-destructive"
                          )} />
                          {gate.label}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">{gate.detail}</p>
                        {gate.action && <p className="mt-1 text-xs font-medium">{gate.action}</p>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className={cn(
              "rounded-xl border p-4",
              report.status === "ready" && "border-emerald-500/30 bg-emerald-500/5",
              report.status === "warning" && "border-amber-500/30 bg-amber-500/5",
              report.status === "blocked" && "border-destructive/30 bg-destructive/5"
            )}>
              <p className="font-medium">
                {report.status === "ready"
                  ? "Ambiente profissional ativo"
                  : report.status === "warning"
                    ? "Ambiente ativo com recomendações"
                    : "Há recursos que precisam ser ativados"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {report.ready} de {report.total} verificações concluídas.
              </p>
            </div>
            <div className="divide-y rounded-xl border">
              {report.checks.map((check) => {
                const Icon = statusIcon[check.status];
                return (
                  <div key={check.id} className="flex items-start gap-3 p-4">
                    <Icon className={cn(
                      "mt-0.5 h-4 w-4 shrink-0",
                      check.status === "ready" && "text-emerald-500",
                      check.status === "warning" && "text-amber-500",
                      check.status === "blocked" && "text-destructive"
                    )} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{check.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{check.detail}</p>
                      {check.action && <p className="mt-1 text-xs font-medium">{check.action}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
