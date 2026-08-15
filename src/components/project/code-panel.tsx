"use client";

import { useEffect, useMemo, useState } from "react";
import { FileCode2, GitCompare, Pencil, Play, RotateCcw } from "lucide-react";
import { AppFile } from "@/lib/engine/app-types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FileTree } from "@/components/project/file-tree";
import { CodeDiff } from "@/components/project/code-diff";

interface CodePanelProps {
  files: AppFile[];
  entry?: string | null;
  /** Aplica as edições (persiste e re-executa o preview). */
  onApply: (files: AppFile[]) => void;
}

/**
 * Aba de Código (Fase 3): árvore de arquivos (FileTree) + editor simples com
 * duas visões — "Editar" (textarea monoespaçada) e "Diff" (CodeDiff: antes/
 * depois do arquivo em relação ao salvo). Edições ficam locais até "Aplicar e
 * executar" / "Aceitar", que persiste e re-roda o preview. Sem Monaco: leve.
 */
export function CodePanel({ files, entry, onApply }: CodePanelProps) {
  const [draft, setDraft] = useState<AppFile[]>(files);
  const [selected, setSelected] = useState<string>(entry || files[0]?.path || "");
  const [view, setView] = useState<"edit" | "diff">("edit");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Recarrega o rascunho quando o projeto muda (nova geração/versão).
  useEffect(() => {
    setDraft(files);
    setSelected((cur) => (files.some((f) => f.path === cur) ? cur : entry || files[0]?.path || ""));
  }, [files, entry]);

  const current = draft.find((f) => f.path === selected);
  const savedCurrent = files.find((f) => f.path === selected);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(files), [draft, files]);
  const changedPaths = useMemo(() => {
    const saved = new Map(files.map((f) => [f.path, f.content]));
    const paths = new Set<string>();
    for (const f of draft) if (saved.get(f.path) !== f.content) paths.add(f.path);
    for (const f of files) if (!draft.some((d) => d.path === f.path)) paths.add(f.path);
    return Array.from(paths);
  }, [draft, files]);

  function updateContent(content: string) {
    setDraft((d) => d.map((f) => (f.path === selected ? { ...f, content } : f)));
  }

  function toggleFolder(folder: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FileCode2 className="h-3.5 w-3.5" />
          {draft.length} arquivo{draft.length > 1 ? "s" : ""}
          {changedPaths.length > 0 && (
            <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-300">
              {changedPaths.length} alterado{changedPaths.length > 1 ? "s" : ""}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1.5">
          <div className="inline-flex rounded-lg border p-0.5">
            <button
              type="button"
              onClick={() => setView("edit")}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                view === "edit" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Pencil className="h-3 w-3" /> Editar
            </button>
            <button
              type="button"
              onClick={() => setView("diff")}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                view === "diff" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <GitCompare className="h-3 w-3" /> Diff
            </button>
          </div>
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
        <FileTree
          files={draft}
          selected={selected}
          entry={entry}
          changedPaths={changedPaths}
          collapsed={collapsed}
          onToggleFolder={toggleFolder}
          onSelect={setSelected}
        />

        {view === "diff" ? (
          <CodeDiff
            path={selected}
            original={savedCurrent?.content ?? ""}
            updated={current?.content ?? ""}
            onAccept={() => onApply(draft)}
            onReject={() => setDraft(files)}
          />
        ) : (
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
        )}
      </div>
    </div>
  );
}
