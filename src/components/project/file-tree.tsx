"use client";

import { useMemo } from "react";
import { ChevronDown, ChevronRight, FileCode2, FolderClosed, FolderOpen } from "lucide-react";
import type { AppFile } from "@/lib/engine/app-types";
import { cn } from "@/lib/utils";

/**
 * Árvore de arquivos da versão atual (Fase 3 — file tree + diff editor).
 *
 * Consome os arquivos já materializados de `staged-generation.ts` /
 * `visual-editor-history.ts` (o chamador passa `AppFile[]`), monta uma árvore
 * de pastas dobráveis e destaca os arquivos com mudança pendente (badge). Sem
 * dependências pesadas — apenas ícones e estado de seleção controlado pelo pai.
 */

interface FileTreeProps {
  files: AppFile[];
  selected: string;
  entry?: string | null;
  /** Caminhos com diff pendente (aparecem com um marcador). */
  changedPaths?: string[];
  /** Pastas colapsadas (controlado pelo pai). */
  collapsed?: Set<string>;
  onToggleFolder?: (folder: string) => void;
  onSelect: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  file?: AppFile;
}

function buildTree(files: AppFile[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map() };
  for (const file of files) {
    const parts = file.path.replace(/^\.?\//, "").split("/");
    let node = root;
    let prefix = "";
    parts.forEach((part, index) => {
      prefix = prefix ? `${prefix}/${part}` : part;
      let child = node.children.get(part);
      if (!child) {
        child = { name: part, path: prefix, children: new Map() };
        node.children.set(part, child);
      }
      if (index === parts.length - 1) child.file = file;
      node = child;
    });
  }
  return root;
}

function sortedChildren(node: TreeNode): TreeNode[] {
  // Pastas antes de arquivos; dentro do grupo, ordem alfabética estável.
  return Array.from(node.children.values()).sort((a, b) => {
    const aFolder = a.children.size > 0 && !a.file;
    const bFolder = b.children.size > 0 && !b.file;
    if (aFolder !== bFolder) return aFolder ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function FileTree({
  files,
  selected,
  entry,
  changedPaths = [],
  collapsed,
  onToggleFolder,
  onSelect,
}: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  const changed = useMemo(() => new Set(changedPaths.map((path) => path.replace(/^\.?\//, ""))), [changedPaths]);
  const entryPath = (entry || files[0]?.path || "").replace(/^\.?\//, "");

  function renderNode(node: TreeNode, level: number): JSX.Element {
    const isFolder = !node.file && node.children.size > 0;
    if (isFolder) {
      const isCollapsed = collapsed?.has(node.path) ?? false;
      const folderChanged = [...changed].some((path) => path.startsWith(`${node.path}/`));
      return (
        <div key={node.path}>
          <button
            type="button"
            onClick={() => onToggleFolder?.(node.path)}
            className="flex w-full items-center gap-1 truncate px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-secondary"
            style={{ paddingLeft: 8 + level * 12 }}
            title={node.path}
          >
            {isCollapsed ? <ChevronRight className="h-3 w-3 shrink-0 opacity-60" /> : <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />}
            {isCollapsed ? <FolderClosed className="h-3 w-3 shrink-0 opacity-60" /> : <FolderOpen className="h-3 w-3 shrink-0 opacity-60" />}
            <span className="truncate">{node.name}</span>
            {folderChanged && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />}
          </button>
          {!isCollapsed && sortedChildren(node).map((child) => renderNode(child, level + 1))}
        </div>
      );
    }
    const path = node.path;
    const isChanged = changed.has(path);
    return (
      <button
        key={path}
        type="button"
        onClick={() => onSelect(path)}
        title={path}
        className={cn(
          "flex w-full items-center gap-1.5 truncate px-2 py-1 text-left text-xs transition-colors",
          path === selected ? "bg-brand-500/15 text-foreground" : "text-muted-foreground hover:bg-secondary"
        )}
        style={{ paddingLeft: 8 + level * 12 + 12 }}
      >
        <FileCode2 className="h-3 w-3 shrink-0 opacity-70" />
        <span className="truncate">{node.name}</span>
        {isChanged && <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" title="Alteração pendente" />}
        {path === entryPath && (
          <span className="ml-auto rounded bg-emerald-500/15 px-1 text-[9px] font-semibold text-emerald-600 dark:text-emerald-300">
            entry
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="w-52 shrink-0 overflow-y-auto border-r bg-secondary/30 py-1 scrollbar-thin">
      {sortedChildren(tree).map((child) => renderNode(child, 0))}
    </div>
  );
}
