import { isAppCode, isMultiFile, type AppCode } from "@/lib/engine/app-types";
import { isValidSchema } from "@/lib/engine/types";
import { applyDiff } from "@/lib/engine/operation-blocks";

export interface VersionSummary {
  kind: "app" | "site" | "unknown";
  files: number;
  characters: number;
  label: string;
}

function appCharacters(app: AppCode): number {
  if (isMultiFile(app)) return app.files.reduce((total, file) => total + file.content.length, 0);
  return app.code?.length ?? 0;
}

export function summarizeVersion(schema: unknown): VersionSummary {
  if (isAppCode(schema)) {
    const files = isMultiFile(schema) ? schema.files.length : 1;
    return {
      kind: "app",
      files,
      characters: appCharacters(schema),
      label: files === 1 ? "Aplicativo · 1 arquivo" : `Aplicativo · ${files} arquivos`,
    };
  }

  if (isValidSchema(schema)) {
    const serialized = JSON.stringify(schema);
    const pages = Array.isArray(schema.pages) ? schema.pages.length : 0;
    return {
      kind: "site",
      files: pages,
      characters: serialized.length,
      label: pages === 1 ? "Site · 1 página" : `Site · ${pages} páginas`,
    };
  }

  return { kind: "unknown", files: 0, characters: 0, label: "Versão legada" };
}

export function versionDelta(current: unknown, target: unknown): string {
  const before = summarizeVersion(current);
  const after = summarizeVersion(target);

  if (before.kind !== after.kind) return `${before.label} → ${after.label}`;

  const fileDelta = after.files - before.files;
  const charDelta = after.characters - before.characters;
  const parts: string[] = [];

  if (fileDelta) parts.push(`${fileDelta > 0 ? "+" : ""}${fileDelta} ${after.kind === "site" ? "página(s)" : "arquivo(s)"}`);
  if (charDelta) parts.push(`${charDelta > 0 ? "+" : ""}${charDelta.toLocaleString("pt-BR")} caracteres`);

  return parts.length ? parts.join(" · ") : "Mesmo tamanho estrutural";
}

export function recoveryLabel(targetLabel?: string | null): string {
  const clean = targetLabel?.trim();
  return `Recuperação automática · antes de restaurar ${clean || "versão anterior"}`.slice(0, 120);
}

// ── Checkpoints e comparação visual entre versões ──────────────────────────

/**
 * Normaliza o nome de um checkpoint (versão marcada manualmente pelo criador,
 * ex.: "Aprovado pelo cliente"). Remove espaços extras e limita o tamanho.
 */
export function checkpointLabel(name: string | null | undefined): string {
  const clean = (name ?? "").replace(/\s+/g, " ").trim();
  return (clean || "Checkpoint").slice(0, 80);
}

export type FileChangeStatus = "added" | "removed" | "changed" | "same";

export interface FileChange {
  path: string;
  status: FileChangeStatus;
  added: number;
  removed: number;
}

export interface VersionComparison {
  fromLabel: string;
  toLabel: string;
  filesAdded: number;
  filesRemoved: number;
  filesChanged: number;
  files: FileChange[];
}

/** Extrai um mapa caminho→conteúdo de qualquer schema de app (single ou multi). */
function filesOf(schema: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!isAppCode(schema)) return map;
  if (isMultiFile(schema)) {
    for (const file of schema.files) map.set(file.path, file.content ?? "");
  } else {
    map.set(schema.entry || "App.jsx", schema.code ?? "");
  }
  return map;
}

/**
 * Compara duas versões arquivo a arquivo, para um diff visual: quais arquivos
 * foram adicionados, removidos ou alterados, e quantas linhas em cada um.
 * Ordena colocando as mudanças primeiro (adicionado/removido/alterado) e os
 * arquivos iguais por último, tudo em ordem alfabética dentro de cada grupo.
 */
export function buildVersionComparison(
  fromSchema: unknown,
  toSchema: unknown,
  labels?: { from?: string; to?: string }
): VersionComparison {
  const before = filesOf(fromSchema);
  const after = filesOf(toSchema);
  const paths = Array.from(new Set([...before.keys(), ...after.keys()])).sort();

  const files: FileChange[] = [];
  let filesAdded = 0;
  let filesRemoved = 0;
  let filesChanged = 0;

  for (const path of paths) {
    const a = before.get(path);
    const b = after.get(path);
    if (a === undefined && b !== undefined) {
      const diff = applyDiff("", b);
      files.push({ path, status: "added", added: diff.added, removed: 0 });
      filesAdded += 1;
    } else if (a !== undefined && b === undefined) {
      const diff = applyDiff(a, "");
      files.push({ path, status: "removed", added: 0, removed: diff.removed });
      filesRemoved += 1;
    } else if (a !== undefined && b !== undefined) {
      const diff = applyDiff(a, b);
      if (diff.changed) {
        files.push({ path, status: "changed", added: diff.added, removed: diff.removed });
        filesChanged += 1;
      } else {
        files.push({ path, status: "same", added: 0, removed: 0 });
      }
    }
  }

  const rank: Record<FileChangeStatus, number> = { added: 0, removed: 1, changed: 2, same: 3 };
  files.sort((x, y) => rank[x.status] - rank[y.status] || (x.path < y.path ? -1 : 1));

  return {
    fromLabel: labels?.from?.trim() || "Versão anterior",
    toLabel: labels?.to?.trim() || "Versão atual",
    filesAdded,
    filesRemoved,
    filesChanged,
    files,
  };
}

/** Frase curta resumindo uma comparação, para exibir no topo do diff. */
export function comparisonHeadline(cmp: VersionComparison): string {
  const parts: string[] = [];
  if (cmp.filesAdded) parts.push(`${cmp.filesAdded} adicionado(s)`);
  if (cmp.filesChanged) parts.push(`${cmp.filesChanged} alterado(s)`);
  if (cmp.filesRemoved) parts.push(`${cmp.filesRemoved} removido(s)`);
  return parts.length ? parts.join(" · ") : "Nenhuma diferença de arquivos";
}
