import type { AppCode, AppFile } from "@/lib/engine/app-types";
import type { PreviewElementSelection, PreviewSourceCandidate } from "./visual-selection";

export interface VisualRefinementVerification {
  valid: boolean;
  changedPaths: string[];
  expectedPaths: string[];
  reason: "target_changed" | "project_changed" | "no_change" | "target_not_changed";
}

export interface VisualRefinementBaseline {
  path: string;
  signature: string;
}

function appFiles(app: AppCode | null | undefined): AppFile[] {
  if (!app) return [];
  if (app.files?.length) return app.files;
  return typeof app.code === "string" ? [{ path: "App.jsx", content: app.code }] : [];
}

function currentFiles(code: string | null, files: AppFile[] | null | undefined): AppFile[] {
  if (files?.length) return files;
  return typeof code === "string" ? [{ path: "App.jsx", content: code }] : [];
}

function contentSignature(content: string): string {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index++) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${content.length}:${(hash >>> 0).toString(16)}`;
}

export function createVisualRefinementBaseline(
  code: string | null,
  files: AppFile[] | null | undefined
): VisualRefinementBaseline[] {
  return currentFiles(code, files)
    .map((file) => ({ path: file.path, signature: contentSignature(file.content) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function changedPaths(before: VisualRefinementBaseline[], after: AppFile[]): string[] {
  const previous = new Map(before.map((file) => [file.path, file.signature]));
  const next = new Map(after.map((file) => [file.path, contentSignature(file.content)]));
  const paths = Array.from(new Set(Array.from(previous.keys()).concat(Array.from(next.keys()))));
  return paths
    .filter((path) => previous.get(path) !== next.get(path))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Confirma que uma edição disparada pela seleção visual produziu uma alteração
 * real. Quando há uma correspondência forte com o código-fonte, ao menos um
 * dos arquivos candidatos precisa ter sido modificado.
 */
export function verifyVisualRefinement(
  beforeCode: string | null,
  beforeFiles: AppFile[] | null | undefined,
  result: AppCode,
  candidates: PreviewSourceCandidate[]
): VisualRefinementVerification {
  return verifyVisualRefinementBaseline(
    createVisualRefinementBaseline(beforeCode, beforeFiles),
    result,
    candidates
  );
}

export function verifyVisualRefinementBaseline(
  baseline: VisualRefinementBaseline[],
  result: AppCode,
  candidates: PreviewSourceCandidate[]
): VisualRefinementVerification {
  const changed = changedPaths(baseline, appFiles(result));
  const expected = candidates
    .filter((candidate) => candidate.score >= 8)
    .map((candidate) => candidate.path);

  if (!changed.length) {
    return { valid: false, changedPaths: [], expectedPaths: expected, reason: "no_change" };
  }
  if (!expected.length) {
    return { valid: true, changedPaths: changed, expectedPaths: [], reason: "project_changed" };
  }
  if (changed.some((path) => expected.includes(path))) {
    return { valid: true, changedPaths: changed, expectedPaths: expected, reason: "target_changed" };
  }
  return {
    valid: false,
    changedPaths: changed,
    expectedPaths: expected,
    reason: "target_not_changed",
  };
}

function clean(value: string, max = 280): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Instrução usada uma única vez quando a primeira edição não atingiu o alvo. */
export function buildVisualRefinementRecoveryPrompt(input: {
  originalRequest: string;
  selection: PreviewElementSelection;
  verification: VisualRefinementVerification;
  candidates: PreviewSourceCandidate[];
}): string {
  const expected = input.verification.expectedPaths.length
    ? input.verification.expectedPaths
    : input.candidates.slice(0, 3).map((candidate) => candidate.path);
  const changed = input.verification.changedPaths.length
    ? input.verification.changedPaths.join(", ")
    : "nenhum arquivo";

  return [
    "⚙️ RECUPERAÇÃO DA EDIÇÃO VISUAL — segunda e última tentativa.",
    `Pedido original: ${clean(input.originalRequest, 600)}`,
    `Elemento selecionado: <${input.selection.tag}> ${clean(input.selection.label || input.selection.text, 180)}`,
    input.selection.text ? `Texto atual: "${clean(input.selection.text, 220)}"` : "",
    input.selection.nearbyText ? `Contexto próximo: "${clean(input.selection.nearbyText, 320)}"` : "",
    expected.length
      ? `Arquivos-fonte que devem ser conferidos e, se contiverem o elemento, editados: ${expected.join(", ")}.`
      : "Não houve correspondência literal forte; localize o componente pelo texto, função e contexto informados.",
    `A resposta anterior alterou: ${changed}, mas não comprovou a mudança solicitada no alvo.`,
    "Aplique agora somente a alteração pedida ao elemento selecionado. Preserve todo o restante do projeto.",
    "Para arquivo existente, devolva somente AD_PATCH com AD_SEARCH literal e único + AD_REPLACE. Use AD_FILE apenas para criar arquivo indispensável.",
    "Não explique, não devolva o projeto inteiro e não altere áreas sem relação com o pedido.",
  ].filter(Boolean).join("\n\n");
}
