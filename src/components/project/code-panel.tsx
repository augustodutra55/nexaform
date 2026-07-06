"use client";

import { useEffect, useMemo, useState } from "react";
import { FileCode2, FolderClosed, Play, RotateCcw } from "lucide-react";
import { AppFile } from "@/lib/engine/app-types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface CodePanelProps {
  files: AppFile[];
  entry?: string | null;
  /** Aplica as edições (persiste e re-executa o preview). */
  onApply: (files: AppFile[]) => void;
}

/** Deriva a "profundidade" de um caminho para indentar a árvore. */
function depth(path: string) {
  return path.split("/").length - 1;
}
function baseName(path: string) {
  return path.split("/").pop() || path;
}

/**
 * Aba de Código: árvore de arquivos + editor simples (textarea monoespaçada).
 * Edições ficam locais até "Aplicar e executar", que persiste e re-roda o preview.
 * Sem dependências pesadas de editor — direto e honesto.
 */
export function CodePanel({ files, entry, onApply }: CodePanelProps) {
  const [draft, setDraft] = useState<AppFile[]>(files);
  const [selected, setSelected] = useState<string>(entry || files[0]?.path || "");

  // Recarrega o rascunho quando o projeto muda (nova geração/versão).
  useEffect(() => {
    setDraft(files);
    setSelected((cur) => (files.some((f) => f.path === cur) ? cur : entry || files[0]?.path || ""));
  }, [files, entry]);

  const sorted = useMemo(() => [...draft].sort((a, b) => a.path.localeCompare(b.path)), [draft]);
  const current = draft.find((f) => f.path === selected);
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(files),
    [draft, files]
  );

  function updateContent(content: string) {
    setDraft((d) => d.map((f) => (f.path === selected ? { ...f, content } : f)));
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FileCode2 className="h-3.5 w-3.5" />
          {draft.length} arquivo{draft.length > 1 ? "s" : ""}
        </span>
        <div className="flex items-center gap-1.5">
          {dirty && (
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setDraft(files)}>
              <RotateCcw className="h-3 w-3" /> Descartar
            </Button>
          )}
          <Button
            variant="brand"
            size="sm"
            className="h-7 gap-1 text-xs"
            disabled={!dirty}
            onClick={() => onApply(draft)}
          >
            <Play className="h-3 w-3" /> Aplicar e executar
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Árvore de arquivos */}
        <div className="w-52 shrink-0 overflow-y-auto border-r bg-secondary/30 py-1 scrollbar-thin">
          {sorted.map((f) => (
            <button
              key={f.path}
              onClick={() => setSelected(f.path)}
              title={f.path}
              className={cn(
                "flex w-full items-center gap-1.5 truncate px-2 py-1 text-left text-xs transition-colors",
                f.path === selected ? "bg-brand-500/15 text-foreground" : "text-muted-foreground hover:bg-secondary"
              )}
              style={{ paddingLeft: 8 + depth(f.path) * 12 }}
            >
              {depth(f.path) > 0 ? <FolderClosed className="h-3 w-3 shrink-0 opacity-50" /> : null}
              <FileCode2 className="h-3 w-3 shrink-0 opacity-70" />
              <span className="truncate">{baseName(f.path)}</span>
              {f.path === (entry || files[0]?.path) && (
                <span className="ml-auto rounded bg-emerald-500/15 px-1 text-[9px] font-semibold text-emerald-600 dark:text-emerald-300">
                  entry
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Editor do arquivo selecionado */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b px-3 py-1.5 text-[11px] text-muted-foreground">{selected}</div>
          <textarea
            value={current?.content ?? ""}
            onChange={(e) => updateContent(e.target.value)}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none bg-background p-3 font-mono text-xs leading-relaxed text-foreground outline-none scrollbar-thin"
            style={{ tabSize: 2 }}
          />
        </div>
      </div>
    </div>
  );
}
