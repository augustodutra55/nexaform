import ts from "typescript";
import type { AppCode, AppFile, ProjectQualityIssue } from "./app-types";
import { buildBackendBlueprint } from "./backend-blueprint";

/** These are blocking regressions, including during intermediate build stages. */
export const REGRESSION_ISSUE_CODES = new Set([
  "regression_runtime", "regression_backend", "regression_access",
  "regression_integration", "regression_media",
]);

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** A removal must name its target. "Remove FAQ" cannot authorize losing agenda. */
export function explicitlyRemoves(message: string, targets: string[]): boolean {
  const request = normalized(message);
  const names = targets.map(normalized).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!names.length) return false;
  const expression = new RegExp(
    "\\b(?:remova|remover|retire|retirar|exclua|excluir|elimine|eliminar|desative|desativar|remove|delete|disable)\\s+" +
    "(?:(?:o|a|os|as|um|uma|apenas|somente|modulo|tela|colecao|funcionalidade|recurso|integracao|de|do|da)\\s+){0,6}" +
    "(?:" + names.join("|") + ")(?![\\w-])", "g"
  );
  let match: RegExpExecArray | null;
  while ((match = expression.exec(request))) {
    const prefix = request.slice(Math.max(0, match.index - 70), match.index);
    if (!/\b(?:nao|nunca|jamais|evite)(?:\s+[\w-]+){0,5}\s*$/.test(prefix)) return true;
  }
  return false;
}

function cleanPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}

/** Only modules reachable from the entry count as retained capabilities. */
function reachableFiles(app: AppCode): AppFile[] {
  const files = app.files?.length ? app.files : [{ path: "App.jsx", content: app.code || "" }];
  const byPath = new Map(files.map((file) => [cleanPath(file.path), file]));
  const entry = app.entry || files.find((file) => /(^|\/)App\.(jsx|tsx|js|ts)$/.test(file.path))?.path || files[0].path;
  const pending = [cleanPath(entry)];
  const seen = new Set<string>();
  while (pending.length) {
    const path = pending.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);
    const file = byPath.get(path);
    if (!file) continue;
    const source = ts.createSourceFile(path, file.content, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      let dependency: string | undefined;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        dependency = node.moduleSpecifier.text;
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        dependency = node.arguments[0].text;
      }
      if (dependency?.startsWith(".")) {
        const base = cleanPath(`${path.slice(0, Math.max(0, path.lastIndexOf("/")))}/${dependency}`);
        const target = [base, ...[".jsx", ".js", ".tsx", ".ts"].flatMap((ext) => [base + ext, base + "/index" + ext])]
          .find((candidate) => byPath.has(candidate));
        if (target) pending.push(target);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return files.filter((file) => seen.has(cleanPath(file.path)));
}

function accessPath(node: ts.Expression, aliases: Map<string, string>): string {
  if (ts.isIdentifier(node)) return aliases.get(node.text) || node.text;
  if (ts.isPropertyAccessExpression(node)) return `${accessPath(node.expression, aliases)}.${node.name.text}`;
  if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteral(node.argumentExpression)) {
    return `${accessPath(node.expression, aliases)}.${node.argumentExpression.text}`;
  }
  if (ts.isParenthesizedExpression(node)) return accessPath(node.expression, aliases);
  return "";
}

function capabilities(files: AppFile[]) {
  const calls = new Map<string, { method: string; target: string; path: string }>();
  const media = new Set<string>();
  for (const file of files) {
    const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
    const aliases = new Map<string, string>();
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const path = accessPath(node.initializer, aliases);
        if (/^(?:window\.|globalThis\.)?AD(?:\.|$)/.test(path)) aliases.set(node.name.text, path);
      }
      if (ts.isCallExpression(node)) {
        const path = accessPath(node.expression, aliases);
        const method = path.replace(/^(?:window\.|globalThis\.)?AD\./, "");
        if (method !== path && /^(?:list|get|count|insert|update|remove|availability|email|upload|auth\.(?:me|signIn|signUp|signOut)|actions\.run|payments\.checkout|voice\.(?:speak|listen|cancel)|settings\.get)$/.test(method)) {
          const arg = node.arguments[0];
          const target = !["update", "remove", "email", "upload"].includes(method) && !method.startsWith("auth.") && !method.startsWith("voice.") && arg && ts.isStringLiteralLike(arg) ? arg.text : "";
          calls.set(`${method}:${target}`, { method, target, path: file.path });
        }
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source);
        if (["img", "video", "audio"].includes(tag)) media.add(tag);
        if (tag === "iframe" && /(?:youtube(?:-nocookie)?\.com\/embed\/|player\.vimeo\.com\/video\/)/.test(node.getText(source))) media.add("video");
      }
      if (ts.isPropertyAssignment(node) && node.name.getText(source) === "backgroundImage" &&
          /(?:url\(|ADIMG:)/.test(node.initializer.getText(source))) media.add("img");
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { calls, media };
}

function aliasesFor(target: string): string[] {
  const aliases: Record<string, string[]> = {
    agendamentos: ["agenda", "agendamento", "agendamentos"],
    procedimentos: ["procedimento", "procedimentos"],
    profissionais: ["profissional", "profissionais"],
    pacientes: ["paciente", "pacientes"],
  };
  return aliases[target] || [target];
}

/** Deterministic pre-save comparison. It does not execute code or call AI. */
export function detectProjectRegressions(previous: AppCode, candidate: AppCode, message: string): ProjectQualityIssue[] {
  const beforeFiles = reachableFiles(previous);
  const afterFiles = reachableFiles(candidate);
  const before = capabilities(beforeFiles);
  const after = capabilities(afterFiles);
  const errors: ProjectQualityIssue[] = [];
  const push = (code: string, text: string, path?: string) => errors.push({ code, message: text, path });

  for (const [key, call] of before.calls) {
    if (after.calls.has(key)) continue;
    const names = call.method.startsWith("auth.") ? ["login", "autenticacao", call.method]
      : call.target ? aliasesFor(call.target) : [call.method];
    if (explicitlyRemoves(message, names)) continue;
    push("regression_runtime", `O refinamento removeu AD.${call.method}${call.target ? `('${call.target}')` : ""} da jornada alcançável. Restaure a capacidade anterior.`, call.path);
  }

  const beforeBackend = buildBackendBlueprint({ ...previous, files: beforeFiles });
  const afterBackend = buildBackendBlueprint({ ...candidate, files: afterFiles });
  for (const collection of beforeBackend.collections.filter((item) => item.source === "manifest")) {
    if (explicitlyRemoves(message, aliasesFor(collection.collection))) continue;
    const next = afterBackend.collections.find((item) => item.collection === collection.collection);
    if (!next || next.source !== "manifest") {
      push("regression_backend", `O contrato da coleção '${collection.collection}' foi removido. Preserve o AD_BACKEND anterior.`);
      continue;
    }
    for (const [field, rule] of Object.entries(collection.dataContract.fields)) {
      const nextRule = next.dataContract.fields[field];
      if ((!nextRule || (rule.required && !nextRule.required) || (rule.unique && !nextRule.unique) ||
          (rule.reference && rule.reference.collection !== nextRule.reference?.collection)) && !explicitlyRemoves(message, [field])) {
        push("regression_backend", `O campo/validação '${collection.collection}.${field}' desapareceu ou foi enfraquecido. Preserve o contrato de dados.`);
      }
    }
    if ((collection.profile !== "catalog" && next.profile === "catalog") ||
        (collection.profile === "authenticated" && collection.authenticatedScope === "own" && next.authenticatedScope === "all") ||
        (collection.allowedRoles.length > 0 && (!next.allowedRoles.length || next.allowedRoles.some((role) => !collection.allowedRoles.includes(role))))) {
      push("regression_access", `A coleção '${collection.collection}' ampliou acesso público, escopo ou papéis. Preserve as permissões; alterações de acesso exigem revisão explícita.`);
    }
  }

  const groups = [
    ["automação", beforeBackend.automations.map((item) => item.name), afterBackend.automations.map((item) => item.name)],
    ["ação HTTP", beforeBackend.actions.map((item) => item.name), afterBackend.actions.map((item) => item.name)],
    ["webhook", beforeBackend.inbound.map((item) => item.name), afterBackend.inbound.map((item) => item.name)],
    ["preço de pagamento", beforeBackend.payments?.prices.map((item) => item.key) || [], afterBackend.payments?.prices.map((item) => item.key) || []],
  ] as const;
  for (const [label, oldNames, newNames] of groups) {
    for (const name of oldNames) {
      if (!newNames.includes(name) && !explicitlyRemoves(message, [name])) {
        push("regression_integration", `A integração ${label} '${name}' desapareceu do manifesto. Restaure-a sem expor credenciais.`);
      }
    }
  }
  for (const tag of before.media) {
    const names = tag === "img" ? ["imagem", "imagens", "foto", "fotos"] : tag === "video" ? ["video", "videos"] : ["audio", "podcast"];
    if (!after.media.has(tag) && !explicitlyRemoves(message, names)) {
      push("regression_media", `O refinamento removeu toda a mídia '${tag}' alcançável. Preserve o player/imagem ou a substituição equivalente.`);
    }
  }
  return errors;
}
