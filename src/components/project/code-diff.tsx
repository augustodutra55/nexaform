"use client";

import { useMemo } from "react";
import { Check, Minus, Plus, X } from "lucide-react";
import { applyDiff, type DiffLine } from "@/lib/engine/operation-blocks";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Editor de diff antes/depois (Fase 3 — file tree + diff editor).
 *
 * Usa `applyDiff` de operation-blocks.ts (LCS de linhas próprio, sem Monaco e
 * sem a lib `diff`) para mostrar as linhas iguais/adicionadas/removidas de um
 * arquivo. Aceitar/rejeitar é delegado ao pai, que chama a rota
 * /api/versions/[versionId]/apply.
 */

interface CodeDiffProps {
  path: string;
  /** Conteúdo salvo na versão atual. */
  original: string;
  /** Conteúdo proposto (nova geração/edição). */
  updated: string;
  /** Sem proposta: mostra só o arquivo atual, sem controles de aceite. */
  readOnly?: boolean;
  onAccept?: () => void;
  onReject?: () => void;
  accepting?: boolean;
}

function lineNumber(value?: number): string {
  return value === undefined ? "" : String(value);
}

export function CodeDiff({ path, original, updated, readOnly, onAccept, onReject, accepting }: CodeDiffProps) {
  const diff = useMemo(() => applyDiff(original, updated), [original, updated]);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <span className="truncate text-[11px] text-muted-foreground">{path}</span>
        <div className="flex items-center gap-2">
          {diff.changed && (
            <span className="flex items-center gap-2 text-[11px] tabular-nums">
              <span className="text-emerald-600 dark:text-emerald-400">+{diff.added}</span>
              <span className="text-red-600 dark:text-red-400">-{diff.removed}</span>
            </span>
          )}
          {!readOnly && diff.changed && (
            <>
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={onReject} disabled={accepting}>
                <X className="h-3 w-3" /> Rejeitar
              </Button>
              <Button variant="brand" size="sm" className="h-7 gap-1 text-xs" onClick={onAccept} disabled={accepting}>
                <Check className="h-3 w-3" /> {accepting ? "Aplicando…" : "Aceitar"}
              </Button>
            </>
          )}
        </div>
      </div>

      {!diff.changed ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
          {readOnly ? "Selecione um arquivo para ver o código." : "Nenhuma alteração pendente neste arquivo."}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto scrollbar-thin font-mono text-xs leading-relaxed">
          {diff.lines.map((line: DiffLine, index) => (
            <div
              key={index}
              className={cn(
                "flex items-start",
                line.kind === "add" && "bg-emerald-500/10",
                line.kind === "del" && "bg-red-500/10"
              )}
            >
              <span className="w-10 shrink-0 select-none px-1 text-right text-[10px] text-muted-foreground/60">
                {lineNumber(line.oldLine)}
              </span>
              <span className="w-10 shrink-0 select-none px-1 text-right text-[10px] text-muted-foreground/60">
                {lineNumber(line.newLine)}
              </span>
              <span
                className={cn(
                  "w-4 shrink-0 select-none text-center",
                  line.kind === "add" && "text-emerald-600 dark:text-emerald-400",
                  line.kind === "del" && "text-red-600 dark:text-red-400"
                )}
              >
                {line.kind === "add" ? <Plus className="inline h-3 w-3" /> : line.kind === "del" ? <Minus className="inline h-3 w-3" /> : ""}
              </span>
              <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all px-2 text-foreground/90">{line.text || " "}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
