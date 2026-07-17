import type { AppCode, AppFile, GenerationPlan, ProjectQualityIssue, ProjectQualityReport } from "./app-types";

const SCRIPT_EXTENSIONS = ["", ".jsx", ".js", ".tsx", ".ts"];
const FORBIDDEN_IMPORTS = new Set([
  "fs", "node:fs", "path", "node:path", "http", "node:http", "https", "node:https",
  "child_process", "node:child_process", "crypto", "node:crypto", "os", "node:os",
]);

function normalizePath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  const result: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") result.pop();
    else result.push(part);
  }
  return result.join("/");
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function issue(code: string, message: string, path?: string): ProjectQualityIssue {
  return { code, message, path };
}

function importSources(content: string): string[] {
  const sources: string[] = [];
  const pattern = /(?:import\s+(?:[^"']+?\s+from\s+)?|export\s+[^"']+?\s+from\s+|import\s*\()(["'])([^"']+)\1/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content))) sources.push(match[2]);
  return sources;
}

function resolvesRelative(from: string, source: string, paths: Set<string>): boolean {
  const base = normalizePath(`${dirname(from)}/${source}`);
  for (const extension of SCRIPT_EXTENSIONS) {
    if (paths.has(`${base}${extension}`)) return true;
    if (paths.has(`${base}/index${extension || ".jsx"}`)) return true;
  }
  return false;
}

function validateFiles(app: AppCode, plan?: GenerationPlan): { errors: ProjectQualityIssue[]; warnings: ProjectQualityIssue[] } {
  const errors: ProjectQualityIssue[] = [];
  const warnings: ProjectQualityIssue[] = [];
  const files: AppFile[] = app.files ?? [];
  if (!files.length) {
    errors.push(issue("single_file", "O projeto precisa ser multi-arquivo; a IA devolveu apenas um arquivo."));
    return { errors, warnings };
  }

  const paths = new Set<string>();
  for (const file of files) {
    const path = normalizePath(file.path);
    if (!path || /(^|\/)\.\.(\/|$)/.test(file.path.replace(/\\/g, "/")) || /(^|\/)node_modules(\/|$)/.test(path)) {
      errors.push(issue("unsafe_path", "Caminho de arquivo inválido ou inseguro.", file.path));
      continue;
    }
    if (paths.has(path)) errors.push(issue("duplicate_path", "Arquivo duplicado no projeto.", path));
    paths.add(path);
  }

  const entry = normalizePath(app.entry ?? "");
  if (!entry || !paths.has(entry)) errors.push(issue("missing_entry", "O arquivo de entrada não existe no projeto.", app.entry));

  for (const file of files) {
    const path = normalizePath(file.path);
    const lines = file.content.split(/\r?\n/).length;
    if (lines > 220) errors.push(issue("file_too_large", `Arquivo com ${lines} linhas; divida em componentes menores.`, path));
    else if (lines > 150) warnings.push(issue("file_large", `Arquivo com ${lines} linhas; o limite recomendado é 150.`, path));

    if (/import\s+["'][^"']+\.css["']/.test(file.content)) errors.push(issue("css_import", "CSS de pacote/arquivo não é suportado pelo runtime; use Tailwind.", path));
    if (/\b(?:window\.)?location\.(?:href|assign|replace)\b|\bwindow\.location\s*=/.test(file.content)) errors.push(issue("location_navigation", "Use navegação por estado; window.location não é permitido.", path));
    if (/from\s+["']react-router(?:-dom)?["']/.test(file.content)) errors.push(issue("react_router", "react-router não é suportado neste runtime; use navegação por estado.", path));
    if (/\b(?:localStorage|sessionStorage)\b/.test(file.content)) warnings.push(issue("browser_storage", "Prefira window.AD para persistência vendável e multiusuário.", path));
    if (/https?:\/\/(?:www\.)?(?:picsum\.photos|source\.unsplash\.com)\//.test(file.content)) warnings.push(issue("random_stock", "Imagem principal aleatória detectada; use ADIMG contextual.", path));

    for (const source of importSources(file.content)) {
      const packageName = source.startsWith("@") ? source.split("/").slice(0, 2).join("/") : source.split("/")[0];
      if (/\.css(?:\?|$)/.test(source)) {
        errors.push(issue("css_import", `Import de CSS não suportado: ${source}. Use Tailwind.`, path));
      } else if (FORBIDDEN_IMPORTS.has(source) || FORBIDDEN_IMPORTS.has(packageName)) {
        errors.push(issue("node_import", `Import de Node não suportado: ${source}.`, path));
      } else if (source.startsWith(".") && !resolvesRelative(path, source, paths)) {
        errors.push(issue("missing_import", `Import relativo não encontrado: ${source}.`, path));
      }
    }
  }

  const entryFile = files.find((file) => normalizePath(file.path) === entry);
  if (entryFile && !/export\s+default\b/.test(entryFile.content)) errors.push(issue("missing_default_export", "O entry precisa exportar o componente raiz como default.", entry));
  if (entryFile && entryFile.content.split(/\r?\n/).length > 90) warnings.push(issue("thick_entry", "App.jsx deveria apenas montar os componentes e ficar abaixo de 60 linhas.", entry));

  if (plan?.requiredCapabilities.some((capability) => capability.indexOf("window.AD") >= 0)) {
    const joined = files.map((file) => file.content).join("\n");
    if (!/\b(?:window\.)?AD\./.test(joined)) warnings.push(issue("missing_ad_data", "O pedido exige dados reais, mas nenhuma integração window.AD foi encontrada."));
  }
  return { errors, warnings };
}

export function validateAppProject(app: AppCode, plan?: GenerationPlan, repaired = false): ProjectQualityReport {
  const { errors, warnings } = validateFiles(app, plan);
  const score = Math.max(0, 100 - errors.length * 20 - warnings.length * 4);
  return { valid: errors.length === 0, score, repaired, errors, warnings };
}

export function issueKey(value: ProjectQualityIssue): string {
  return `${value.code}:${value.path || ""}:${value.message}`;
}
