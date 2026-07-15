import type { AppFile } from "./app-types";

export type FileOperation =
  | { op: "create" | "update"; path: string; content: string }
  | { op: "delete"; path: string }
  | { op: "patch"; path: string; search: string; replace: string };

export interface OperationBlockResult {
  reply: string;
  ops: FileOperation[];
}

function attributePath(attributes: string): string {
  const match = /\bpath\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(attributes);
  return (match?.[1] || match?.[2] || match?.[3] || "").trim();
}

function rawBlock(value: string): string {
  return value.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
}

/**
 * Extrai arquivos brutos de uma resposta de refinamento sem depender de JSON.
 * Também aceita o padrão Markdown comum como rede de segurança quando o modelo
 * acrescenta um título de arquivo antes da cerca de código.
 */
export function parseOperationBlocks(text: string): OperationBlockResult | null {
  const ops: OperationBlockResult["ops"] = [];
  const filePattern = /<AD_FILE\b([^>]*)>([\s\S]*?)<\/AD_FILE>/gi;
  let fileMatch: RegExpExecArray | null;
  while ((fileMatch = filePattern.exec(text)) !== null) {
    const attributes = fileMatch[1];
    const path = attributePath(attributes);
    if (!path) continue;
    const opMatch = /\bop\s*=\s*["'](create|update)["']/i.exec(attributes);
    const content = fileMatch[2]
      .trim()
      .replace(/^```(?:jsx|tsx|js|ts)?\s*\r?\n?/i, "")
      .replace(/\r?\n?```\s*$/, "")
      .trim();
    if (!content) continue;
    ops.push({
      op: opMatch?.[1]?.toLowerCase() === "create" ? "create" : "update",
      path,
      content,
    });
  }

  const patchPattern = /<AD_PATCH\b([^>]*)>([\s\S]*?)<\/AD_PATCH>/gi;
  let patchMatch: RegExpExecArray | null;
  while ((patchMatch = patchPattern.exec(text)) !== null) {
    const path = attributePath(patchMatch[1]);
    const searchMatch = /<AD_SEARCH>([\s\S]*?)<\/AD_SEARCH>/i.exec(patchMatch[2]);
    const replaceMatch = /<AD_REPLACE>([\s\S]*?)<\/AD_REPLACE>/i.exec(patchMatch[2]);
    if (!path || !searchMatch || !replaceMatch) continue;
    const search = rawBlock(searchMatch[1]);
    if (!search) continue;
    ops.push({ op: "patch", path, search, replace: rawBlock(replaceMatch[1]) });
  }

  const deletePattern = /<AD_DELETE\b([^>]*)\/?\s*>/gi;
  let deleteMatch: RegExpExecArray | null;
  while ((deleteMatch = deletePattern.exec(text)) !== null) {
    const path = attributePath(deleteMatch[1]);
    if (path) ops.push({ op: "delete", path });
  }

  if (!ops.length) {
    const markdownPattern = /(?:^|\n)(?:#{1,6}\s*)?(?:arquivo\s*:\s*)?`?([\w./-]+\.(?:jsx|tsx|js|ts))`?\s*\r?\n```(?:jsx|tsx|js|ts)?\s*\r?\n([\s\S]*?)```/gi;
    let markdownMatch: RegExpExecArray | null;
    while ((markdownMatch = markdownPattern.exec(text)) !== null) {
      const content = markdownMatch[2].trim();
      if (content) ops.push({ op: "update", path: markdownMatch[1], content });
    }
  }

  if (!ops.length) return null;
  const replyMatch = /<AD_REPLY>([\s\S]*?)<\/AD_REPLY>/i.exec(text);
  return {
    reply: replyMatch?.[1]?.trim() || "Pronto! Arquivos atualizados.",
    ops,
  };
}

/** Aplica patches somente quando o trecho existe uma única vez, evitando corrupção. */
export function applyFileOperations(current: AppFile[], ops: FileOperation[]): AppFile[] | null {
  const map = new Map<string, string>();
  for (const file of current) map.set(file.path.replace(/^\.?\//, ""), file.content);
  let touched = 0;
  for (const operation of ops) {
    const path = operation.path.replace(/^\.?\//, "").trim();
    if (!path || path.split("/").includes("..")) return null;
    if (operation.op === "delete") {
      if (!map.delete(path)) return null;
      touched++;
      continue;
    }
    if (operation.op === "patch") {
      const before = map.get(path);
      if (before == null) return null;
      const first = before.indexOf(operation.search);
      if (first < 0 || before.indexOf(operation.search, first + operation.search.length) >= 0) return null;
      map.set(path, before.slice(0, first) + operation.replace + before.slice(first + operation.search.length));
      touched++;
      continue;
    }
    if (!operation.content.trim()) return null;
    if (operation.op === "create" && map.has(path)) return null;
    if (operation.op === "update" && !map.has(path)) return null;
    map.set(path, operation.content);
    touched++;
  }
  if (!touched || map.size === 0) return null;
  return Array.from(map.entries()).map(([path, content]) => ({ path, content }));
}
