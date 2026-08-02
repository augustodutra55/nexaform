import type { AppFile } from "@/lib/engine/app-types";
import type { PreviewElementSelection } from "./visual-selection";

export type DirectVisualEditReason =
  | "changed"
  | "empty_text"
  | "unsupported_element"
  | "unsafe_value"
  | "source_not_found"
  | "ambiguous_source";

export type DirectVisualStylePreset =
  | "emphasis"
  | "subtle"
  | "rounded"
  | "spacious"
  | "centered";

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

const STYLE_PRESETS: Record<DirectVisualStylePreset, { add: string[]; remove: RegExp[] }> = {
  emphasis: {
    add: ["font-bold", "text-violet-600", "dark:text-violet-300"],
    remove: [/^font-(?:thin|extralight|light|normal|medium|semibold|extrabold|black)$/],
  },
  subtle: {
    add: ["text-slate-500", "dark:text-slate-400"],
    remove: [/^text-(?:violet|purple|indigo|blue|cyan|emerald|green|amber|orange|red)-\d{2,3}$/],
  },
  rounded: {
    add: ["rounded-2xl", "shadow-lg"],
    remove: [/^rounded(?:-(?:none|sm|md|lg|xl|2xl|3xl|full))?$/, /^shadow(?:-(?:none|sm|md|lg|xl|2xl|inner))?$/],
  },
  spacious: {
    add: ["p-6"],
    remove: [/^p-\d+(?:\.5)?$/],
  },
  centered: {
    add: ["text-center"],
    remove: [/^text-(?:left|right|justify|start|end)$/],
  },
};

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

function openingTagPattern(value: string, tag: string): RegExp {
  const tokens = value.trim().split(/\s+/).map(escapeRegex);
  const safeTag = escapeRegex(tag);
  return new RegExp(`(<${safeTag}\\b[^>]*>)(\\s*)${tokens.join("\\s+")}(?:\\s|<)`, "g");
}

function updateStaticClassName(opening: string, preset: DirectVisualStylePreset): string | null {
  if (/\bclassName\s*=\s*\{/.test(opening)) return null;
  const config = STYLE_PRESETS[preset];
  const match = opening.match(/\bclassName\s*=\s*(["'])([^"']*)\1/);
  const current = match ? match[2].split(/\s+/).filter(Boolean) : [];
  const retained = current.filter((token) => !config.remove.some((pattern) => pattern.test(token)));
  const next = Array.from(new Set(retained.concat(config.add))).join(" ");
  if (match) return opening.replace(match[0], `className=${match[1]}${next}${match[1]}`);
  return opening.replace(/>$/, ` className="${next}">`);
}

/**
 * Aplica um preset visual somente quando o elemento pode ser localizado de
 * forma única e usa className estático. Expressões dinâmicas permanecem no
 * refinamento por IA para evitar corromper JSX válido.
 */
export function applyDirectVisualStyleEdit(
  files: AppFile[],
  selection: PreviewElementSelection,
  preset: DirectVisualStylePreset
): DirectVisualEditResult {
  const currentText = selection.text.trim();
  if (!currentText || !STYLE_PRESETS[preset]) {
    return { changed: false, files, reason: "unsupported_element" };
  }
  const matches = files.flatMap((file) => {
    const pattern = openingTagPattern(currentText, selection.tag);
    return Array.from(file.content.matchAll(pattern)).map((match) => ({ file, match }));
  });
  if (!matches.length) return { changed: false, files, reason: "source_not_found" };
  if (matches.length > 1) return { changed: false, files, reason: "ambiguous_source" };

  const target = matches[0];
  const opening = target.match[1];
  const updated = updateStaticClassName(opening, preset);
  if (!updated) return { changed: false, files, reason: "unsupported_element" };
  const edited = files.map((file) =>
    file.path === target.file.path
      ? { ...file, content: file.content.slice(0, target.match.index) + target.match[0].replace(opening, updated) + file.content.slice((target.match.index ?? 0) + target.match[0].length) }
      : file
  );
  return { changed: true, files: edited, path: target.file.path, reason: "changed" };
}

function safeHref(value: string): string | null {
  const href = value.trim().slice(0, 1200);
  if (!href || /[\u0000-\u001f\u007f"'<>\{\}]/.test(href)) return null;
  if (/^(?:https:\/\/|mailto:|tel:|#|\/(?!\/)|\.\.?\/)/i.test(href)) {
    return href.replace(/&/g, "&amp;");
  }
  return null;
}

/** Atualiza apenas href literal de um link identificado sem ambiguidade. */
export function applyDirectVisualLinkEdit(
  files: AppFile[],
  selection: PreviewElementSelection,
  nextHref: string
): DirectVisualEditResult {
  if (selection.tag !== "a" || !selection.href) {
    return { changed: false, files, reason: "unsupported_element" };
  }
  const replacement = safeHref(nextHref);
  if (!replacement) return { changed: false, files, reason: "unsafe_value" };

  const matches = files.flatMap((file) => {
    const pattern = /<a\b[^>]*>/g;
    return Array.from(file.content.matchAll(pattern))
      .filter((match) => {
        const href = match[0].match(/\bhref\s*=\s*(["'])([^"']*)\1/);
        return href?.[2] === selection.href;
      })
      .map((match) => ({ file, match }));
  });
  const narrowed = matches.length > 1 && selection.text
    ? matches.filter(({ file, match }) => {
        const after = file.content.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 1200);
        const closing = after.indexOf("</a>");
        return closing >= 0 && after.slice(0, closing).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() === selection.text;
      })
    : matches;
  if (!narrowed.length) return { changed: false, files, reason: "source_not_found" };
  if (narrowed.length > 1) return { changed: false, files, reason: "ambiguous_source" };

  const target = narrowed[0];
  const opening = target.match[0];
  const updated = opening.replace(/\bhref\s*=\s*(["'])([^"']*)\1/, (_all, quote) => `href=${quote}${replacement}${quote}`);
  const start = target.match.index ?? 0;
  const edited = files.map((file) => file.path === target.file.path
    ? { ...file, content: file.content.slice(0, start) + updated + file.content.slice(start + opening.length) }
    : file);
  return { changed: true, files: edited, path: target.file.path, reason: "changed" };
}
