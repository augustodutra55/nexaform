"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Save,
  RotateCcw,
  Pencil,
  GitCompareArrows,
  Check,
  X,
  Loader2,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { timeAgo, cn } from "@/lib/utils";
import {
  buildVersionComparison,
  comparisonHeadline,
  versionDelta,
  type FileChangeStatus,
} from "@/lib/history/version-history";
import { formatUsd } from "@/lib/cost/project-cost";

export interface HistoryVersion {
  id: string;
  label: string;
  created_at: string;
  schema: any;
}

interface CostSummary {
  totalUsd: number;
  billableGenerations: number;
  averageUsd: number;
  suggestedPrice: number;
}

interface Props {
  projectId: string;
  versions: HistoryVersion[];
  currentSchema: unknown;
  onSaveVersion: (label: string) => Promise<void>;
  onRestoreVersion: (v: HistoryVersion) => void;
  onVersionRenamed?: (id: string, label: string) => void;
  onClose?: () => void;
}

const STATUS_STYLE: Record<FileChangeStatus, string> = {
  added: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  removed: "bg-red-500/15 text-red-600 dark:text-red-400",
  changed: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  same: "bg-muted text-muted-foreground",
};

const STATUS_LABEL: Record<FileChangeStatus, string> = {
  added: "novo",
  removed: "removido",
  changed: "alterado",
  same: "igual",
};

export function VersionHistoryPanel({
  projectId,
  versions,
  currentSchema,
  onSaveVersion,
  onRestoreVersion,
  onVersionRenamed,
  onClose,
}: Props) {
  const [items, setItems] = useState<HistoryVersion[]>(versions);
  const [checkpointName, setCheckpointName] = useState("");
  const [saving, setSaving] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [compareId, setCompareId] = useState<string | null>(null);
  const [cost, setCost] = useState<CostSummary | null>(null);

  useEffect(() => setItems(versions), [versions]);

  useEffect(() => {
    let active = true;
    fetch(`/api/cost/${projectId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active && data && typeof data.totalUsd === "number") setCost(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [projectId]);

  const comparison = useMemo(() => {
    if (!compareId) return null;
    const target = items.find((v) => v.id === compareId);
    if (!target) return null;
    return buildVersionComparison(target.schema, currentSchema, {
      from: target.label || "Versão escolhida",
      to: "Versão atual",
    });
  }, [compareId, items, currentSchema]);

  async function handleCheckpoint() {
    setSaving(true);
    try {
      await onSaveVersion(checkpointName.trim() || "Checkpoint");
      setCheckpointName("");
      toast.success("Checkpoint salvo no histórico");
    } finally {
      setSaving(false);
    }
  }

  async function handleRename(id: string) {
    const label = renameValue.trim();
    if (!label) {
      setRenamingId(null);
      return;
    }
    setItems((cur) => cur.map((v) => (v.id === id ? { ...v, label } : v)));
    setRenamingId(null);
    onVersionRenamed?.(id, label);
    try {
      const res = await fetch(`/api/versions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) throw new Error();
      toast.success("Versão renomeada");
    } catch {
      toast.error("Não consegui renomear agora");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-lg border bg-secondary/30 p-3">
        <Wallet className="h-5 w-5 shrink-0 text-muted-foreground" />
        {cost ? (
          <div className="flex flex-1 flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
            <span className="font-semibold">{formatUsd(cost.totalUsd)}</span>
            <span className="text-xs text-muted-foreground">
              custo real deste projeto · {cost.billableGenerations} geração(ões)
            </span>
            {cost.suggestedPrice > 0 && (
              <span className="text-xs text-muted-foreground">
                sugestão de venda: <span className="font-medium text-foreground">{formatUsd(cost.suggestedPrice)}</span>
              </span>
            )}
          </div>
        ) : (
          <span className="flex-1 text-xs text-muted-foreground">Calculando o custo do projeto…</span>
        )}
      </div>

      <div className="flex items-end gap-2 rounded-lg border bg-secondary/30 p-3">
        <div className="flex-1 space-y-1">
          <label className="text-xs text-muted-foreground">Marcar um checkpoint (estado atual)</label>
          <Input
            value={checkpointName}
            onChange={(e) => setCheckpointName(e.target.value)}
            placeholder="Ex.: Entrega 1 · aprovado pelo cliente"
            className="h-8"
          />
        </div>
        <Button size="sm" onClick={handleCheckpoint} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Salvar
        </Button>
      </div>

      <div className="space-y-2">
        {items.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma versão ainda. Gere algo pelo chat para começar o histórico.
          </p>
        )}
        {items.map((v, i) => {
          const older = items[i + 1];
          const delta = older ? versionDelta(older.schema, v.schema) : null;
          const isRenaming = renamingId === v.id;
          const isComparing = compareId === v.id;
          return (
            <div key={v.id} className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {isRenaming ? (
                    <div className="flex items-center gap-1">
                      <Input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRename(v.id);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        className="h-7"
                      />
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRename(v.id)}>
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRenamingId(null)}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{v.label || `Versão ${items.length - i}`}</p>
                      {i === 0 && <Badge variant="secondary" className="h-5 text-[10px]">atual</Badge>}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {timeAgo(v.created_at)}
                    {delta ? ` · ${delta}` : ""}
                  </p>
                </div>
                {!isRenaming && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="Renomear"
                      onClick={() => {
                        setRenamingId(v.id);
                        setRenameValue(v.label || "");
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn("h-8 w-8", isComparing && "bg-secondary")}
                      title="Comparar com a versão atual"
                      onClick={() => setCompareId(isComparing ? null : v.id)}
                    >
                      <GitCompareArrows className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        onRestoreVersion(v);
                        toast.success("Versão restaurada");
                        onClose?.();
                      }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Restaurar
                    </Button>
                  </div>
                )}
              </div>

              {isComparing && comparison && (
                <div className="mt-3 rounded-md border bg-muted/30 p-2">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    {comparison.fromLabel} → {comparison.toLabel} · {comparisonHeadline(comparison)}
                  </p>
                  <div className="space-y-1">
                    {comparison.files
                      .filter((f) => f.status !== "same")
                      .slice(0, 40)
                      .map((f) => (
                        <div key={f.path} className="flex items-center gap-2 text-xs">
                          <Badge className={cn("h-5 w-16 justify-center text-[10px]", STATUS_STYLE[f.status])}>
                            {STATUS_LABEL[f.status]}
                          </Badge>
                          <span className="truncate font-mono">{f.path}</span>
                          <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                            {f.added > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{f.added}</span>}
                            {f.added > 0 && f.removed > 0 && " "}
                            {f.removed > 0 && <span className="text-red-600 dark:text-red-400">-{f.removed}</span>}
                          </span>
                        </div>
                      ))}
                    {comparison.files.every((f) => f.status === "same") && (
                      <p className="text-xs text-muted-foreground">Idêntico à versão atual.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
