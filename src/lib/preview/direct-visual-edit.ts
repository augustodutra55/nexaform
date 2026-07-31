import type { AppFile } from "@/lib/engine/app-types";
import type { PreviewElementSelection } from "./visual-selection";

export type DirectVisualEditReason =
  | "changed"
  | "empty_text"
  | "unsupported_element"
  | "source_not_found"
  | "ambiguous_source";

export interface DirectVisualEditResult {
  changed: boolean;
  files: AppFile[];
  path?: string;
  reason: DirectVisualEditReason;
}

const TEXT_TAGS = new Set([
  "a",
  "button",
  "figcaption",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "label",
  "li",
  "p",
  "small",
  "span",
  "strong",
]);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function jsxText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/{/g, "&#123;")
    .replace(/}/g, "&#125;");
}

function directTextPattern(value: string, tag: string): RegExp {
  const tokens = value.trim().split(/\s+/).map(escapeRegex);
  const safeTag = escapeRegex(tag);
  return new RegExp(
    `(<${safeTag}\\b[^>]*>)(\\s*)${tokens.join("\\s+")}(\\s*)(</${safeTag}>)`,
    "g"
  );
}

/**
 * Edita somente texto JSX direto e comprovadamente único. Conteúdo dinâmico,
 * texto composto por filhos e correspondências repetidas ficam para o fluxo de
 * refinamento por IA, que possui contexto e verificação próprios.
 */
export function applyDirectVisualTextEdit(
  files: AppFile[],
  selection: PreviewElementSelection,
  nextText: string
): DirectVisualEditResult {
  const currentText = selection.text.trim();
  const cleanNextText = nextText.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!currentText || !cleanNextText) {
    return { changed: false, files, reason: "empty_text" };
  }
  if (!TEXT_TAGS.has(selection.tag)) {
    return { changed: false, files, reason: "unsupported_element" };
  }

  const matches = files.flatMap((file) => {
    const pattern = directTextPattern(currentText, selection.tag);
    return Array.from(file.content.matchAll(pattern)).map((match) => ({ file, match }));
  });
  if (!matches.length) {
    return { changed: false, files, reason: "source_not_found" };
  }
  if (matches.length > 1) {
    return { changed: false, files, reason: "ambiguous_source" };
  }

  const target = matches[0];
  const pattern = directTextPattern(currentText, selection.tag);
  const replacement = jsxText(cleanNextText);
  const edited = files.map((file) =>
    file.path === target.file.path
      ? {
          ...file,
          content: file.content.replace(
            pattern,
            (_whole, opening, before, after, closing) =>
              `${opening}${before}${replacement}${after}${closing}`
          ),
        }
      : file
  );
  return { changed: true, files: edited, path: target.file.path, reason: "changed" };
}
