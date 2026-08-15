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

  // Salvamento de AD_FILE final truncado (sem </AD_FILE>): o provedor às vezes
  // corta os últimos tokens da etapa. Em vez de descartar a etapa inteira,
  // recuperamos o último bloco aberto até o próximo marcador AD_ ou o fim do
  // texto. Se o arquivo estiver realmente incompleto, o quality gate o rejeita
  // depois; mas quando só faltou a tag de fechamento, a etapa é preservada.
  const openTags = [...text.matchAll(/<AD_FILE\b([^>]*)>/gi)];
  const lastOpen = openTags[openTags.length - 1];
  if (lastOpen) {
    const contentStart = (lastOpen.index ?? 0) + lastOpen[0].length;
    const rest = text.slice(contentStart);
    if (!/<\/AD_FILE\s*>/i.test(rest)) {
      const path = attributePath(lastOpen[1]);
      const stop = rest.search(/<AD_(?:FILE|PATCH|DELETE|REPLY)\b/i);
      const content = (stop >= 0 ? rest.slice(0, stop) : rest)
        .replace(/^```(?:jsx|tsx|js|ts)?\s*\r?\n?/i, "")
        .replace(/\r?\n?```\s*$/, "")
        .trim();
      const opMatch = /\bop\s*=\s*["'](create|update)["']/i.exec(lastOpen[1]);
      if (path && content.length > 20 && !ops.some((op) => op.op !== "delete" && op.path === path)) {
        ops.push({ op: opMatch?.[1]?.toLowerCase() === "create" ? "create" : "update", path, content });
      }
    }
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

  // Alguns modelos misturam blocos AD_FILE com um envelope JSON de ops/files.
  // O parser anterior escolhia os blocos e descartava silenciosamente a parte
  // JSON, inclusive quando o AD_FILE era apenas um no-op e a mudança real
  // estava no envelope. Só aceitamos um objeto JSON completo e verificável.
  if (ops.length) {
    const candidates: string[] = [];
    const starts = Array.from(text.matchAll(/(?:^|\n)\s*\{/g));
    for (let index = starts.length - 1; index >= 0; index -= 1) {
      const match = starts[index];
      const offset = (match.index || 0) + match[0].lastIndexOf("{");
      candidates.push(text.slice(offset).trim());
    }
    for (const candidate of candidates) {
      try {
        const envelope = JSON.parse(candidate);
        const structured = Array.isArray(envelope?.ops)
          ? envelope.ops
          : Array.isArray(envelope?.files)
            ? envelope.files.map((file: any) => ({ op: "update", path: file?.path, content: file?.content }))
            : [];
        for (const raw of structured) {
          const path = typeof raw?.path === "string" ? raw.path.trim() : "";
          if (!path) continue;
          if (raw.op === "delete") ops.push({ op: "delete", path });
          else if ((raw.op === "patch" || typeof raw.search === "string") && typeof raw.search === "string" && typeof raw.replace === "string") {
            addPatch(ops, path, raw.search, raw.replace);
          } else if (typeof raw.content === "string" && raw.content.trim()) {
            ops.push({ op: raw.op === "create" ? "create" : "update", path, content: raw.content });
          }
        }
        break;
      } catch {}
    }
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

  // Também aproveita pares caminho+cerca de objetos JSON-like, mesmo quando
  // vieram acompanhados de AD_FILE. Cada par continua atômico e verificável.
  const jsonLikeFilePattern = /["']?([\w./-]+\.(?:jsx|tsx|js|ts))["']?\s*:\s*```[^\r\n]*\r?\n([\s\S]*?)```/gi;
  let jsonLikeMatch: RegExpExecArray | null;
  while ((jsonLikeMatch = jsonLikeFilePattern.exec(text)) !== null) {
    const content = jsonLikeMatch[2].trim();
    if (content) ops.push({ op: "update", path: jsonLikeMatch[1], content });
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
    // Modelos às vezes reenviam junto um arquivo inalterado e outro realmente
    // corrigido. O no-op não deve invalidar o lote transacional inteiro; se
    // todas as operações forem no-op, `touched` continua zero e o lote falha.
    if (map.get(path) === operation.content) continue;
    // O conteúdo completo é seguro mesmo quando o modelo troca create/update.
    // A existência do caminho determina naturalmente se é criação ou alteração.
    map.set(path, operation.content);
    touched++;
  }
  if (!touched || map.size === 0) return null;
  return Array.from(map.entries()).map(([path, content]) => ({ path, content }));
}

// ── Diff de arquivo (Fase 3 — file tree + diff editor) ───────────────────────
// LCS de linhas próprio e sem dependências. Mantém o painel leve (a alternativa
// seria a lib `diff` ~12 KB ou o Monaco pesado — ambos evitados de propósito).

export type DiffLineKind = "same" | "add" | "del";

export interface DiffLine {
  kind: DiffLineKind;
  /** Número da linha no arquivo original (undefined em linhas adicionadas). */
  oldLine?: number;
  /** Número da linha no arquivo novo (undefined em linhas removidas). */
  newLine?: number;
  text: string;
}

export interface FileDiff {
  changed: boolean;
  added: number;
  removed: number;
  lines: DiffLine[];
}

/** Maior subsequência comum de linhas (matriz de comprimentos). */
function lcsMatrix(a: string[], b: string[]): number[][] {
  const rows = a.length;
  const cols = b.length;
  const table: number[][] = Array.from({ length: rows + 1 }, () => new Array(cols + 1).fill(0));
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

/**
 * Compara `original` com `updated` linha a linha e devolve o modelo do diff.
 * `applyDiff` é o nome de contrato desta fase: dada a versão original e a nova
 * de um arquivo, produz o conjunto de linhas (iguais/adicionadas/removidas) que
 * o editor de diff renderiza e que a rota de apply usa para confirmar mudanças.
 */
export function applyDiff(original: string, updated: string): FileDiff {
  const a = original.length ? original.split("\n") : [];
  const b = updated.length ? updated.split("\n") : [];
  const table = lcsMatrix(a, b);
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: "same", oldLine: i + 1, newLine: j + 1, text: a[i] });
      i++; j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push({ kind: "del", oldLine: i + 1, text: a[i] });
      removed++; i++;
    } else {
      lines.push({ kind: "add", newLine: j + 1, text: b[j] });
      added++; j++;
    }
  }
  while (i < a.length) { lines.push({ kind: "del", oldLine: i + 1, text: a[i] }); removed++; i++; }
  while (j < b.length) { lines.push({ kind: "add", newLine: j + 1, text: b[j] }); added++; j++; }
  return { changed: added > 0 || removed > 0, added, removed, lines };
}

/** Aplica um conjunto de arquivos aceitos sobre os arquivos originais,
 * preservando os que não foram tocados. `content` vazio remove o arquivo.
 * Devolve o novo conjunto ou null quando nada muda (evita versão redundante). */
export function applyAcceptedFiles(
  original: AppFile[],
  accepted: Array<{ path: string; content: string | null }>
): AppFile[] | null {
  const map = new Map<string, string>();
  for (const file of original) map.set(file.path.replace(/^\.?\//, ""), file.content);
  let touched = 0;
  for (const change of accepted) {
    const path = String(change.path || "").replace(/^\.?\//, "").trim();
    if (!path || path.split("/").includes("..")) continue;
    if (change.content === null || change.content === "") {
      if (map.delete(path)) touched++;
      continue;
    }
    if (map.get(path) === change.content) continue;
    map.set(path, change.content);
    touched++;
  }
  if (!touched || map.size === 0) return null;
  return Array.from(map.entries()).map(([path, content]) => ({ path, content }));
}
