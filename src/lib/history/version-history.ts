import { isAppCode, isMultiFile, type AppCode } from "@/lib/engine/app-types";
import { isValidSchema } from "@/lib/engine/types";

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
