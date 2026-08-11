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

function addPatch(
  ops: FileOperation[],
  path: string,
  searchValue: string | undefined,
  replaceValue: string | undefined
): void {
  if (!path || searchValue == null || replaceValue == null) return;
  const search = rawBlock(searchValue);
  if (!search) return;
  ops.push({ op: "patch", path, search, replace: rawBlock(replaceValue) });
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

  // O fechamento externo pode faltar quando o provedor corta os últimos tokens.
  // Se SEARCH e REPLACE estão completos, o patch ainda é seguro e aproveitável.
  const patchPattern = /<AD_PATCH\b([^>]*)>([\s\S]*?)(?:<\/AD_PATCH\s*>|(?=<AD_PATCH\b|<AD_FILE\b|<AD_DELETE\b|<AD_REPLY\b|$))/gi;
  let patchMatch: RegExpExecArray | null;
  while ((patchMatch = patchPattern.exec(text)) !== null) {
    const path = attributePath(patchMatch[1]);
    const searchMatch = /<AD_SEARCH\b[^>]*>([\s\S]*?)<\/AD_SEARCH\s*>/i.exec(patchMatch[2]);
    const replaceMatch = /<AD_REPLACE\b[^>]*>([\s\S]*?)<\/AD_REPLACE\s*>/i.exec(patchMatch[2]);
    addPatch(ops, path, searchMatch?.[1], replaceMatch?.[1]);
  }

  // Compatibilidade com o formato SEARCH/REPLACE usado por vários modelos de
  // código. Exige caminho e os dois delimitadores completos para ser atômico.
  const searchReplacePattern = /(?:^|\n)(?:#{1,6}\s*)?`?([\w./-]+\.(?:jsx|tsx|js|ts))`?[^\S\r\n]*\r?\n(?:```(?:diff)?[^\S\r\n]*\r?\n)?<<<<<<< SEARCH[^\S\r\n]*\r?\n([\s\S]*?)\r?\n=======[^\S\r\n]*\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE(?:[^\S\r\n]*\r?\n```)?/gi;
  let searchReplaceMatch: RegExpExecArray | null;
  while ((searchReplaceMatch = searchReplacePattern.exec(text)) !== null) {
    addPatch(ops, searchReplaceMatch[1], searchReplaceMatch[2], searchReplaceMatch[3]);
  }

  const deletePattern = /<AD_DELETE\b([^>]*)\/?\s*>/gi;
  let deleteMatch: RegExpExecArray | null;
  while ((deleteMatch = deletePattern.exec(text)) !== null) {
    const path = attributePath(deleteMatch[1]);
    if (path) ops.push({ op: "delete", path });
  }

  if (!ops.length) {
    // Rede de segurança para provedores que ignoram o contrato e devolvem
    // Markdown. O caminho pode vir em título, negrito, backticks, "Arquivo:",
    // "File 1:" ou nos metadados da própria cerca.
    const fencedPattern = /```([^\r\n]*)\r?\n([\s\S]*?)```/g;
    let fencedMatch: RegExpExecArray | null;
    while ((fencedMatch = fencedPattern.exec(text)) !== null) {
      const info = fencedMatch[1].trim();
      const content = fencedMatch[2].trim();
      if (!content) continue;

      const infoPath = /(?:filename|file|path|title)\s*=\s*["']?([\w./-]+\.(?:jsx|tsx|js|ts))["']?/i.exec(info)?.[1];
      const before = text.slice(Math.max(0, fencedMatch.index - 500), fencedMatch.index);
      const lines = before.split(/\r?\n/).slice(-5).reverse();
      let headingPath = "";
      for (const line of lines) {
        const match = /(?:arquivo|file)?\s*(?:\d+\s*)?(?::|[-–—])?\s*[*_`#>\s]*([\w./-]+\.(?:jsx|tsx|js|ts))[*_`:\s]*$/i.exec(line);
        if (match?.[1]) {
          headingPath = match[1];
          break;
        }
      }
      const path = (infoPath || headingPath || "").replace(/^\.?\//, "");
      if (path) ops.push({ op: "update", path, content });
    }
  }

  if (!ops.length) {
    // Alguns modelos emitem um objeto "JSON-like" com o caminho como chave e
    // o conteúdo numa cerca de código. Não tentamos consertar JSON arbitrário:
    // extraímos apenas pares caminho+cerca, que são atômicos e verificáveis.
    const jsonLikeFilePattern = /["']?([\w./-]+\.(?:jsx|tsx|js|ts))["']?\s*:\s*```[^\r\n]*\r?\n([\s\S]*?)```/gi;
    let jsonLikeMatch: RegExpExecArray | null;
    while ((jsonLikeMatch = jsonLikeFilePattern.exec(text)) !== null) {
      const content = jsonLikeMatch[2].trim();
      if (content) ops.push({ op: "update", path: jsonLikeMatch[1], content });
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
  for (const rawOperation of ops) {
    if (!rawOperation || typeof rawOperation !== "object") return null;
    const raw = rawOperation as any;
    const operation: FileOperation = raw.op === "patch" || raw.op === "replace" ||
      (typeof raw.search === "string" && typeof raw.replace === "string") ||
      (typeof raw.old_content === "string" && typeof raw.new_content === "string")
      ? {
          op: "patch",
          path: String(raw.path || ""),
          search: String(raw.search ?? raw.old_content ?? raw.old ?? ""),
          replace: String(raw.replace ?? raw.new_content ?? raw.new ?? ""),
        }
      : rawOperation;
    const path = String(operation.path || "").replace(/^\.?\//, "").trim();
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
      const after = before.slice(0, first) + operation.replace + before.slice(first + operation.search.length);
      if (after === before) return null;
      map.set(path, after);
      touched++;
      continue;
    }
    if (typeof operation.content !== "string" || !operation.content.trim()) return null;
    if (map.get(path) === operation.content) return null;
    // O conteúdo completo é seguro mesmo quando o modelo troca create/update.
    // A existência do caminho determina naturalmente se é criação ou alteração.
    map.set(path, operation.content);
    touched++;
  }
  if (!touched || map.size === 0) return null;
  return Array.from(map.entries()).map(([path, content]) => ({ path, content }));
}
