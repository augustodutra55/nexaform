import type { AppFile } from "@/lib/engine/app-types";
import type { PreviewElementSelection, PreviewSourceCandidate } from "./visual-selection";

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
  | "compact"
  | "centered"
  | "larger"
  | "smaller"
  | "primary"
  | "dark"
  | "fullWidth";

export type DirectVisualStructureAction = "moveUp" | "moveDown" | "duplicate" | "remove";

export interface DirectVisualEditResult {
  changed: boolean;
  files: AppFile[];
  path?: string;
  reason: DirectVisualEditReason;
}

interface ImportedComponent {
  name: string;
  sourcePath: string;
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
  compact: {
    add: ["p-3"],
    remove: [/^p-\d+(?:\.5)?$/],
  },
  centered: {
    add: ["text-center"],
    remove: [/^text-(?:left|right|justify|start|end)$/],
  },
  larger: {
    add: ["text-2xl"],
    remove: [/^text-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/],
  },
  smaller: {
    add: ["text-sm"],
    remove: [/^text-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/],
  },
  primary: {
    add: ["bg-violet-600", "text-white", "hover:bg-violet-700", "transition-colors"],
    remove: [
      /^bg-[a-z]+-\d{2,3}$/,
      /^text-[a-z]+-\d{2,3}$/,
      /^hover:bg-[a-z]+-\d{2,3}$/,
    ],
  },
  dark: {
    add: ["bg-slate-950", "text-white"],
    remove: [/^bg-[a-z]+-\d{2,3}$/, /^text-[a-z]+-\d{2,3}$/],
  },
  fullWidth: {
    add: ["w-full"],
    remove: [/^w-(?:auto|fit|full|screen|min|max|\d+(?:\/\d+)?)$/],
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

interface NestedTextMatch {
  file: AppFile;
  start: number;
  length: number;
  replacement: string;
}

function nestedLiteralTextMatches(file: AppFile, value: string, tag: string): NestedTextMatch[] {
  const safeTag = escapeRegex(tag);
  const elementPattern = new RegExp(`<${safeTag}\\b[^>]*>([\\s\\S]*?)</${safeTag}>`, "g");
  const expected = value.replace(/\s+/g, " ").trim();
  const matches: NestedTextMatch[] = [];

  for (const element of Array.from(file.content.matchAll(elementPattern))) {
    const inner = element[1];
    const innerStart = (element.index ?? 0) + element[0].indexOf(inner);
    const tags = Array.from(inner.matchAll(/<[^>]+>/g));
    const boundaries = [0]
      .concat(tags.flatMap((match) => [match.index ?? 0, (match.index ?? 0) + match[0].length]))
      .concat(inner.length);
    for (let index = 0; index < boundaries.length - 1; index += 2) {
      const start = boundaries[index];
      const end = boundaries[index + 1];
      const literal = inner.slice(start, end);
      if (/[{}]/.test(literal) || literal.replace(/\s+/g, " ").trim() !== expected) continue;
      const leading = literal.match(/^\s*/)?.[0] ?? "";
      const trailing = literal.match(/\s*$/)?.[0] ?? "";
      matches.push({
        file,
        start: innerStart + start,
        length: literal.length,
        replacement: `${leading}${jsxText(value)}${trailing}`,
      });
    }
  }
  return matches;
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
    const nestedMatches = files.flatMap((file) => nestedLiteralTextMatches(file, currentText, selection.tag));
    if (!nestedMatches.length) return { changed: false, files, reason: "source_not_found" };
    if (nestedMatches.length > 1) return { changed: false, files, reason: "ambiguous_source" };
    const target = nestedMatches[0];
    const edited = files.map((file) => file.path === target.file.path
      ? {
          ...file,
          content: file.content.slice(0, target.start)
            + target.replacement.replace(jsxText(currentText), jsxText(cleanNextText))
            + file.content.slice(target.start + target.length),
        }
      : file);
    return { changed: true, files: edited, path: target.file.path, reason: "changed" };
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

function normalizePath(path: string): string {
  const parts = path.replace(/^\.\//, "").split("/");
  const output: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") output.pop();
    else output.push(part);
  }
  return output.join("/");
}

function resolveImportPath(entryPath: string, specifier: string, files: AppFile[]): string | null {
  const directory = entryPath.includes("/") ? entryPath.replace(/\/[^/]*$/, "") : "";
  const base = normalizePath(`${directory ? `${directory}/` : ""}${specifier}`);
  const candidates = [base, `${base}.jsx`, `${base}.tsx`, `${base}.js`, `${base}.ts`, `${base}/index.jsx`, `${base}/index.tsx`];
  return candidates.find((candidate) => files.some((file) => normalizePath(file.path) === candidate)) ?? null;
}

function importedComponents(entry: AppFile, files: AppFile[]): ImportedComponent[] {
  const imports = /import\s+([A-Z][A-Za-z0-9_$]*)\s+from\s+(["'])(\.{1,2}\/[^"']+)\2\s*;?/g;
  return Array.from(entry.content.matchAll(imports)).flatMap((match) => {
    const sourcePath = resolveImportPath(entry.path, match[3], files);
    return sourcePath ? [{ name: match[1], sourcePath }] : [];
  });
}

interface ComponentInvocation {
  name: string;
  start: number;
  end: number;
  source: string;
}

function componentInvocations(content: string, components: ImportedComponent[]): ComponentInvocation[] {
  const names = new Set(components.map((component) => component.name));
  const pattern = /<([A-Z][A-Za-z0-9_$]*)\b[^>]*(?:\/>|>[\s\S]*?<\/\1\s*>)/g;
  return Array.from(content.matchAll(pattern)).flatMap((match) => {
    if (!names.has(match[1])) return [];
    const start = match.index ?? 0;
    return [{ name: match[1], start, end: start + match[0].length, source: match[0] }];
  });
}

/**
 * Reordena ou replica uma seção multi-arquivo pelo componente importado no
 * arquivo de entrada. A operação só ocorre quando o arquivo-fonte e a chamada
 * JSX são únicos; qualquer ambiguidade mantém o projeto anterior intacto.
 */
export function applyDirectVisualStructureEdit(
  files: AppFile[],
  entryPath: string | null | undefined,
  sourceCandidates: PreviewSourceCandidate[],
  action: DirectVisualStructureAction
): DirectVisualEditResult {
  if (!files.length || !entryPath || !sourceCandidates.length) {
    return { changed: false, files, reason: "source_not_found" };
  }
  const entry = files.find((file) => normalizePath(file.path) === normalizePath(entryPath));
  if (!entry) return { changed: false, files, reason: "source_not_found" };

  const imports = importedComponents(entry, files);
  const ranked = sourceCandidates
    .map((candidate) => ({
      candidate,
      component: imports.find((item) => normalizePath(item.sourcePath) === normalizePath(candidate.path)),
    }))
    .filter((item): item is { candidate: PreviewSourceCandidate; component: ImportedComponent } => !!item.component);
  if (!ranked.length) return { changed: false, files, reason: "source_not_found" };
  if (ranked.length > 1 && ranked[0].candidate.score === ranked[1].candidate.score) {
    return { changed: false, files, reason: "ambiguous_source" };
  }

  const targetComponent = ranked[0].component;
  const invocations = componentInvocations(entry.content, imports);
  const targets = invocations.filter((invocation) => invocation.name === targetComponent.name);
  if (!targets.length) return { changed: false, files, reason: "source_not_found" };
  if (targets.length > 1) return { changed: false, files, reason: "ambiguous_source" };
  const target = targets[0];
  let content = entry.content;

  if (action === "remove") {
    content = content.slice(0, target.start) + content.slice(target.end);
  } else if (action === "duplicate") {
    const indentation = content.slice(0, target.start).match(/(?:^|\n)([ \t]*)[^\n]*$/)?.[1] ?? "";
    content = content.slice(0, target.end) + `\n${indentation}${target.source}` + content.slice(target.end);
  } else {
    const ordered = invocations.sort((a, b) => a.start - b.start);
    const index = ordered.findIndex((invocation) => invocation.start === target.start);
    const neighbor = action === "moveUp" ? ordered[index - 1] : ordered[index + 1];
    if (!neighbor) return { changed: false, files, reason: "unsupported_element" };
    const first = target.start < neighbor.start ? target : neighbor;
    const second = target.start < neighbor.start ? neighbor : target;
    const between = content.slice(first.end, second.start);
    content = content.slice(0, first.start) + second.source + between + first.source + content.slice(second.end);
  }

  if (content === entry.content) return { changed: false, files, reason: "unsupported_element" };
  return {
    changed: true,
    files: files.map((file) => file.path === entry.path ? { ...file, content } : file),
    path: entry.path,
    reason: "changed",
  };
}
