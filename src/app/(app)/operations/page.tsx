"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock3, DollarSign, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Summary {
  periodDays: number;
  migrationRequired: boolean;
  metrics: {
    total: number; completed: number; failed: number; pending: number;
    successRate: number; cost: number; averageDurationMs: number | null;
    p95DurationMs: number | null; failures: Record<string, number>;
  };
  projectsByCost: Array<{ projectId: string; name: string; cost: number; generations: number }>;
  recentFailures: Array<{
    id: string; project: string; provider: string; model: string; code: string;
    message: string; attempt: number; createdAt: string;
  }>;
  runtime: {
    total: number; unique: number;
    recent: Array<{ id: string; project: string; kind: string; message: string; createdAt: string }>;
  };
  generatedAt: string;
}

const money = (value: number) => `$${value.toFixed(4)}`;
const duration = (value: number | null) => value == null ? "—" : value >= 60_000
  ? `${(value / 60_000).toFixed(1)} min`
  : `${(value / 1000).toFixed(1)} s`;

export default function OperationsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/operations/summary", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Falha ao carregar a operação.");
      setSummary(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao carregar a operação.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading && !summary) {
    return <div className="container flex min-h-[50vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  if (error && !summary) {
    return <div className="container max-w-3xl py-12"><Card><CardContent className="py-8 text-center">
      <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive" />
      <p className="font-medium">{error}</p><Button className="mt-4" onClick={load}>Tentar novamente</Button>
    </CardContent></Card></div>;
  }
  if (!summary) return null;

  const cards = [
    { label: "Taxa de sucesso", value: `${summary.metrics.successRate}%`, detail: `${summary.metrics.completed} concluídas`, icon: CheckCircle2 },
    { label: "Falhas", value: String(summary.metrics.failed), detail: `${summary.metrics.pending} em andamento`, icon: AlertTriangle },
    { label: "Latência p95", value: duration(summary.metrics.p95DurationMs), detail: `média ${duration(summary.metrics.averageDurationMs)}`, icon: Clock3 },
    { label: "Custo em 30 dias", value: money(summary.metrics.cost), detail: `${summary.metrics.total} gerações`, icon: DollarSign },
  ];

  return (
    <div className="container space-y-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Activity className="h-6 w-6 text-primary" /> Operação</h1>
          <p className="text-sm text-muted-foreground">Saúde, custo e falhas reais dos últimos {summary.periodDays} dias.</p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Atualizar</Button>
      </div>

      {summary.migrationRequired && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <p className="font-medium text-amber-700 dark:text-amber-300">Observabilidade detalhada aguardando ativação</p>
          <p className="mt-1 text-muted-foreground">Aplique a migração 0013 no Supabase. As métricas básicas continuam disponíveis sem interromper o AD Studio.</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((item) => <Card key={item.label}><CardContent className="flex items-start justify-between p-5">
          <div><p className="text-xs text-muted-foreground">{item.label}</p><p className="mt-1 text-2xl font-semibold">{item.value}</p><p className="mt-1 text-xs text-muted-foreground">{item.detail}</p></div>
          <item.icon className="h-5 w-5 text-primary" />
        </CardContent></Card>)}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Custo por projeto</CardTitle><CardDescription>Projetos que mais consumiram IA no período.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {summary.projectsByCost.length ? summary.projectsByCost.map((row) => (
              <div key={row.projectId} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0"><p className="truncate text-sm font-medium">{row.name}</p><p className="text-xs text-muted-foreground">{row.generations} gerações</p></div>
                <Badge variant="secondary">{money(row.cost)}</Badge>
              </div>
            )) : <p className="text-sm text-muted-foreground">Nenhuma geração no período.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Erros em apps publicados</CardTitle><CardDescription>Falhas reais capturadas no navegador dos visitantes.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {summary.runtime.recent.length ? summary.runtime.recent.map((row) => (
              <div key={row.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">{row.project}</p><Badge variant="outline">{row.kind}</Badge></div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{row.message}</p>
              </div>
            )) : <p className="text-sm text-muted-foreground">Nenhum erro de runtime registrado.</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Falhas recentes de geração</CardTitle><CardDescription>A causa técnica fica visível sem expor chaves nem o conteúdo completo do prompt.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {summary.recentFailures.length ? summary.recentFailures.map((row) => (
            <div key={row.id} className="grid gap-2 rounded-lg border p-3 md:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><p className="font-medium">{row.project}</p><Badge variant="destructive">{row.code}</Badge><span className="text-xs text-muted-foreground">tentativa {row.attempt}</span></div>
                <p className="mt-1 text-sm text-muted-foreground">{row.message}</p>
              </div>
              <p className="text-xs text-muted-foreground md:text-right">{row.provider}<br />{row.model}</p>
            </div>
          )) : <p className="text-sm text-muted-foreground">Nenhuma falha de geração no período.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
