import type { AppCode, AppFile, GenerationPlan, ProjectQualityIssue, ProjectQualityReport } from "./app-types";
import ts from "typescript";

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

/**
 * Erros FATAIS: quebram a execução/renderização do app (ele nem roda). Tudo o
 * mais é erro de COMPLETUDE/política — o site RODA, só está incompleto. Para não
 * falhar e cobrar crédito à toa, o motor ENTREGA um site que roda (mesmo com esses
 * avisos) em vez de recusar tudo — igual ao comportamento do Lovable, que entrega
 * algo para você iterar. Só bloqueamos de fato quando o app não abre.
 */
export const FATAL_ISSUE_CODES = new Set<string>([
  "single_file",
  "unsafe_path",
  "duplicate_path",
  "missing_entry",
  "syntax_error",
  "css_import",
  "node_import",
  "missing_import",
  "missing_default_export",
  "react_router",
  "location_navigation",
]);

/** true quando o app RODA (nenhum erro fatal), mesmo que falte completude. */
export function isRunnableReport(report: Pick<ProjectQualityReport, "errors">): boolean {
  return !report.errors.some((e) => FATAL_ISSUE_CODES.has(e.code));
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

function syntaxErrors(file: AppFile): string[] {
  if (!/\.(?:jsx|tsx|js|ts)$/i.test(file.path)) return [];
  try {
    const result = ts.transpileModule(file.content, {
      fileName: file.path,
      reportDiagnostics: true,
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        isolatedModules: true,
      },
    });
    return (result.diagnostics || [])
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
  } catch (reason) {
    return [`Transpilação falhou: ${reason instanceof Error ? reason.message : String(reason)}`];
  }
}

function resolvedRelative(from: string, source: string, paths: Set<string>): string | null {
  const base = normalizePath(`${dirname(from)}/${source}`);
  for (const extension of SCRIPT_EXTENSIONS) {
    if (paths.has(`${base}${extension}`)) return `${base}${extension}`;
    if (paths.has(`${base}/index${extension || ".jsx"}`)) return `${base}/index${extension || ".jsx"}`;
  }
  return null;
}

function resolvesRelative(from: string, source: string, paths: Set<string>): boolean {
  return resolvedRelative(from, source, paths) !== null;
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
    const compilerErrors = syntaxErrors(file);
    if (compilerErrors.length) {
      errors.push(issue("syntax_error", `JSX/TypeScript inválido: ${compilerErrors.slice(0, 3).join("; ")}`, path));
    }
    // Tamanho é estilo, não correção: um componente grande compila e roda. Nunca
    // deve bloquear a geração — antes derrubava refinamentos com agenda/catálogo
    // VÁLIDOS só por passar de 220 linhas. Fica como aviso para o modelo dividir
    // em componentes menores nas próximas etapas, sem descartar código que funciona.
    if (lines > 220) warnings.push(issue("file_too_large", `Arquivo com ${lines} linhas; considere dividir em componentes menores.`, path));
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

  // Um componente criado mas nunca alcançado a partir do entry não aparece no
  // aplicativo. Isso costuma acontecer quando a IA cria FAQ/depoimentos e
  // esquece de importar/renderizar no App.jsx.
  let reachableSource = "";
  if (entryFile) {
    const byPath = new Map(files.map((file) => [normalizePath(file.path), file]));
    const reachable = new Set<string>();
    const pending = [entry];
    while (pending.length) {
      const current = pending.pop()!;
      if (reachable.has(current)) continue;
      reachable.add(current);
      const file = byPath.get(current);
      if (!file) continue;
      for (const source of importSources(file.content)) {
        if (!source.startsWith(".")) continue;
        const resolved = resolvedRelative(current, source, paths);
        if (resolved && !reachable.has(resolved)) pending.push(resolved);
      }
    }
    reachableSource = files
      .filter((file) => reachable.has(normalizePath(file.path)))
      .map((file) => file.content)
      .join("\n");
    for (const file of files) {
      const path = normalizePath(file.path);
      if (reachable.has(path) || !/\.(?:jsx|tsx|js|ts)$/i.test(path)) continue;
      if (/export\s+default\s+(?:function|class)\s+[A-Z]|export\s+default\s+[A-Z][A-Za-z0-9_$]*|function\s+[A-Z][A-Za-z0-9_$]*\s*\([^)]*\)\s*\{[\s\S]*?</.test(file.content)) {
        errors.push(issue("orphan_component", "Componente criado, mas não importado/renderizado a partir do entry.", path));
      }
    }
  }

  if (plan?.requiredCapabilities.some((capability) => capability.indexOf("window.AD") >= 0)) {
    const joined = reachableSource || files.map((file) => file.content).join("\n");
    if (!/\b(?:window\.)?AD\./.test(joined)) warnings.push(issue("missing_ad_data", "O pedido exige dados reais, mas nenhuma integração window.AD foi encontrada."));
  }
  if (plan?.requiredCapabilities.some((capability) => /autentica|sess[aã]o/i.test(capability))) {
    const joined = reachableSource || files.map((file) => file.content).join("\n");
    if (!/(?:window\.)?AD\s*\.\s*auth|\b(?:signIn|signUp|login|logout)\b/i.test(joined)) {
      errors.push(issue("missing_auth", "O pedido exige autenticação, mas nenhum fluxo de sessão foi implementado."));
    }
  }
  if (plan?.requiredCapabilities.some((capability) => /jornada comercial|pagamento/i.test(capability))) {
    const joined = reachableSource || files.map((file) => file.content).join("\n");
    if (!/checkout|finalizar\s+(?:a\s+)?(?:compra|pedido)|resumo\s+do\s+pedido|continuar\s+para\s+(?:o\s+)?pagamento/i.test(joined)) {
      errors.push(issue("missing_commercial_flow", "O pedido exige jornada comercial, mas checkout/finalização não foi implementado."));
    }
  }
  if (plan) {
    const requested = `${plan.objective}\n${plan.requiredCapabilities.join("\n")}`;
    const joined = reachableSource || files.map((file) => file.content).join("\n");
    const requestedSections: Array<[RegExp, RegExp, string]> = [
      [/\bfaq\b|perguntas frequentes/i, /\bfaq\b|perguntas frequentes/i, "FAQ"],
      [/prova social|depoimentos?|testimonials?/i, /prova social|depoimentos?|testimonials?|avalia[çc][aã]o m[eé]dia/i, "prova social/depoimentos"],
      [/benef[ií]cios?|vantagens?/i, /benef[ií]cios?|vantagens?/i, "benefícios"],
    ];
    for (const [requestPattern, evidencePattern, label] of requestedSections) {
      if (requestPattern.test(requested) && !evidencePattern.test(joined)) {
        errors.push(issue("missing_required_section", `O pedido exige ${label}, mas essa seção não está renderizada no projeto.`));
      }
    }
  }

  if (plan) {
    const joined = files.map((file) => file.content).join("\n");
    const profile = plan.visualProfile;
    const usesThree = /["'](?:three|@react-three\/fiber|@react-three\/drei)(?:["'/])/.test(joined);
    const threeCanvasCount = (joined.match(/<Canvas\b/g) || []).length;
    const usesVideo = /<video\b/i.test(joined);
    const videoTags = joined.match(/<video\b[^>]*>/gi) || [];
    const imageTags = joined.match(/<img\b[^>]*>/gi) || [];
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
    if (profile.allow3D && threeCanvasCount > 1) {
      errors.push(issue("multiple_3d_scenes", `Use uma única cena 3D protagonista; foram encontrados ${threeCanvasCount} componentes Canvas.`));
    }
    if (profile.allow3D && usesThree && !/(?:dpr\s*=\s*\{?\[?\s*1\s*,\s*1\.5|Math\.min\([^)]*1\.5)/.test(joined)) {
      warnings.push(issue("unbounded_3d_dpr", "Limite o devicePixelRatio da cena 3D a 1.5."));
    }
    if (profile.allow3D && usesThree && !/(?:IntersectionObserver|useInView|document\.visibilityState)/.test(joined)) {
      warnings.push(issue("always_running_3d", "Pause ou reduza a cena 3D quando ela sair da viewport."));
    }
    if (profile.allowVideo && !usesVideo) {
      errors.push(issue("missing_video", "O pedido exige vídeo, mas o projeto não contém uma implementação de vídeo responsiva."));
    }
    if (profile.allowVideo && plan.media.videoMode === "placeholder") {
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
    if (usesVideo && videoTags.some((tag) => !/\bplaysInline\b/i.test(tag))) {
      warnings.push(issue("video_inline", "Adicione playsInline para o vídeo funcionar corretamente em celulares e Safari."));
    }
    if (usesVideo && videoTags.some((tag) => !/\bpreload\s*=\s*["']metadata["']/i.test(tag))) {
      warnings.push(issue("video_preload", "Use preload=\"metadata\" para evitar download antecipado pesado."));
    }
    if (imageTags.some((tag) => !/\balt\s*=/.test(tag))) {
      warnings.push(issue("image_alt", "Toda imagem precisa de alt contextual ou alt vazio quando for apenas decorativa."));
    }
    const nonAvatarImages = imageTags.filter((tag) => !/(?:avatar|pravatar|perfil|depoimento)/i.test(tag));
    if (nonAvatarImages.some((tag) => !/\bobject-cover\b/.test(tag))) {
      warnings.push(issue("image_crop", "Imagens de conteúdo devem usar object-cover dentro de proporção fixa para não distorcer."));
    }
    if (nonAvatarImages.length > 1 && nonAvatarImages.slice(1).some((tag) => !/\bloading\s*=\s*["']lazy["']/.test(tag))) {
      warnings.push(issue("image_lazy_loading", "Imagens abaixo da primeira devem usar loading=\"lazy\"."));
    }
    if (nonAvatarImages.some((tag) => !/\bdecoding\s*=\s*["']async["']/.test(tag))) {
      warnings.push(issue("image_async_decode", "Use decoding=\"async\" nas imagens de conteúdo."));
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
