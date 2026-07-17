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
  const externalPackages = new Set<string>();
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
      if (!source.startsWith(".") && packageName !== "react" && packageName !== "react-dom") externalPackages.add(packageName);
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

  if (plan) {
    const joined = files.map((file) => file.content).join("\n");
    const profile = plan.visualProfile;
    const usesThree = /["'](?:three|@react-three\/fiber|@react-three\/drei)(?:["'/])/.test(joined);
    const usesVideo = /<video\b/i.test(joined);
    const videoSources: string[] = [];
    const videoPattern = /<video\b[^>]*\bsrc\s*=\s*["']([^"']*)["'][^>]*>/gi;
    let videoMatch: RegExpExecArray | null;
    while ((videoMatch = videoPattern.exec(joined))) videoSources.push(videoMatch[1].trim());
    const hasMotion = /from\s+["']framer-motion["']|\bmotion\.|\banimate-[\w-]+|@keyframes\b/.test(joined);
    const respectsReducedMotion = /motion-reduce:|prefers-reduced-motion|useReducedMotion/.test(joined);

    if (externalPackages.size > profile.maxExternalPackages) {
      errors.push(issue(
        "dependency_budget",
        `O perfil permite ${profile.maxExternalPackages} pacotes externos, mas o projeto usa ${externalPackages.size}: ${Array.from(externalPackages).join(", ")}.`
      ));
    }
    if (usesThree && !profile.allow3D) {
      errors.push(issue("unrequested_3d", "Bibliotecas 3D foram adicionadas sem o pedido autorizar 3D."));
    }
    if (profile.allow3D && !usesThree) {
      errors.push(issue("missing_3d", "O pedido exige experiência 3D, mas nenhuma implementação Three/React Three Fiber foi encontrada."));
    }
    if (profile.allow3D && usesThree && !/(?:fallback\s*=|<img\b|backgroundImage\s*:)/i.test(joined)) {
      errors.push(issue("missing_3d_fallback", "A cena 3D precisa de fallback estático para celulares e falhas de WebGL."));
    }
    if (profile.allow3D && usesThree && !/(?:dpr\s*=\s*\{?\[?\s*1\s*,\s*1\.5|Math\.min\([^)]*1\.5)/.test(joined)) {
      warnings.push(issue("unbounded_3d_dpr", "Limite o devicePixelRatio da cena 3D a 1.5."));
    }
    if (profile.allowVideo && !usesVideo) {
      errors.push(issue("missing_video", "O pedido exige vídeo, mas o projeto não contém uma implementação de vídeo responsiva."));
    }
    if (profile.allowVideo && plan.media.videoMode === "placeholder") {
      const videoTags = joined.match(/<video\b[^>]*>/gi) || [];
      const hasSafePlaceholder = videoTags.some((tag) =>
        /\bsrc\s*=\s*["']\s*["']/i.test(tag) && /\bdata-ad-media\s*=\s*["']video["']/i.test(tag)
      );
      if (!hasSafePlaceholder) {
        errors.push(issue("missing_video_placeholder", "Sem vídeo enviado, use um slot <video src=\"\" data-ad-media=\"video\">; não invente URL."));
      }
    }
    if (profile.allowVideo && plan.media.videoMode === "uploaded") {
      const usesTrustedVideo = videoSources.some((source) => plan.media.videoUrls.includes(source));
      if (!usesTrustedVideo) {
        errors.push(issue("untrusted_video", "Use exclusivamente um vídeo enviado à Central de Mídia; URLs inventadas não são aceitas."));
      }
    }
    if (!profile.allowVideo && usesVideo) {
      errors.push(issue("unrequested_video", "Vídeo foi inserido sem ser solicitado; use imagem contextual ou movimento leve."));
    }
    if (/BigBuckBunny|commondatastorage\.googleapis\.com\/gtv-videos-bucket\/sample/i.test(joined)) {
      errors.push(issue("demo_video", "Vídeo genérico de demonstração não pode ser usado em projeto comercial."));
    }
    if (usesVideo && !/<video[^>]*\b(?:poster|aria-label)=/i.test(joined)) {
      warnings.push(issue("video_fallback", "Adicione poster ou aria-label ao vídeo para carregamento e acessibilidade."));
    }
    if (profile.motion === "expressive" && !hasMotion) {
      warnings.push(issue("missing_motion", "O perfil pede movimento expressivo, mas nenhuma animação intencional foi encontrada."));
    }
    if (hasMotion && !respectsReducedMotion) {
      warnings.push(issue("reduced_motion", "Adicione suporte a prefers-reduced-motion ou motion-reduce."));
    }
    if (/requestAnimationFrame[\s\S]{0,300}\bset[A-Z]\w*\s*\(/.test(joined)) {
      errors.push(issue("state_per_frame", "Não atualize estado React a cada frame; use refs dentro de requestAnimationFrame."));
    }
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
