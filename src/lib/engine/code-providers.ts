/**
 * Provedores de geração de CÓDIGO (server-only) — o núcleo do clone do Lovable.
 *
 * Ordem: chave do usuário → ANTHROPIC_API_KEY → OPENROUTER_API_KEY → template.
 * Com roteamento de modelo (econômico/premium) e captura de custo real, para
 * o Studio operar barato.
 */
import { AppFile, AppGenerationResult, GenerationMediaAsset, ProjectQualityReport, codeStats, projectStats } from "./app-types";
import { CODE_SYSTEM_PROMPT, CODE_REFINE_SYSTEM_PROMPT, buildCodeUserPrompt } from "./code-prompts";
import { matchTemplate } from "./code-templates";
import { BUDGET_MODEL_OPENROUTER, CostMode, pickTier, modelExecutionPlan, estimateCost, isFunctionalRefinement, isFreeOpenRouterModel } from "./models";
import type { PromptAttachment } from "./prompt-attachments";
import { applyFileOperations, parseOperationBlocks } from "./operation-blocks";
import { buildGenerationPlan, renderGenerationPlan } from "./generation-plan";
import { issueKey, validateAppProject } from "./project-validator";

interface Args {
  message: string;
  /** Projeto atual: multi-arquivo (preferido) ou código single-file legado. */
  currentFiles?: AppFile[] | null;
  currentCode?: string | null;
  name: string;
  userKey?: string | null;
  userProvider?: "claude" | "openrouter" | "local" | null;
  costMode?: CostMode;
  /** Modo real forçado: nunca cai em template/demo — falha claro se não houver IA. */
  forceReal?: boolean;
  /** Permite template enlatado / demo (só quando o usuário aceitar). */
  allowTemplate?: boolean;
  /** Referências locais escolhidas pelo usuário no compositor do AD Studio. */
  attachments?: PromptAttachment[];
  /** Arquivos confiáveis já enviados à Central de Mídia do projeto. */
  mediaAssets?: GenerationMediaAsset[];
  /** Tentativa transacional da fila; usada apenas para diagnóstico e limites. */
  backgroundAttempt?: number;
}

/** Normaliza e valida os arquivos devolvidos pelo modelo. */
function normalizeFiles(rawFiles: any): AppFile[] | null {
  if (!Array.isArray(rawFiles)) return null;
  const files: AppFile[] = [];
  for (const f of rawFiles) {
    if (!f || typeof f.path !== "string" || typeof f.content !== "string") continue;
    const path = f.path.replace(/^\.?\//, "").trim();
    if (!path || !f.content.trim()) continue;
    files.push({ path, content: f.content });
  }
  return files.length ? files : null;
}

/** Dá visibilidade quando o modelo ignora o limite de tamanho, sem bloquear a geração. */
function warnOversizedFiles(files: AppFile[]): void {
  for (const file of files) {
    const lineCount = file.content.split(/\r?\n/).length;
    if (lineCount > 150) {
      console.warn(`[code-engine] Arquivo gerado acima de 150 linhas: ${file.path} (${lineCount} linhas).`);
    }
  }
}

function parse(
  text: string,
  provider: "claude" | "openrouter",
  cost: number,
  model: string,
  current?: AppFile[] | null
): AppGenerationResult | null {
  try {
    const operationBlocks = parseOperationBlocks(text);
    const cleaned = text.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
    // Alguns modelos devolvem arquivos como AD_FILE ou títulos Markdown seguidos
    // de cercas de código. Na primeira etapa esses arquivos completos já são um
    // projeto válido e devem ser aproveitados sem cobrar outra geração.
    let blockEnvelope: any = null;
    if (operationBlocks) {
      if (current?.length) {
        blockEnvelope = operationBlocks;
      } else {
        const blockFiles: Array<{ path: string; content: string }> = [];
        let completeFilesOnly = true;
        for (const operation of operationBlocks.ops) {
          if (operation.op !== "create" && operation.op !== "update") {
            completeFilesOnly = false;
            break;
          }
          blockFiles.push({ path: operation.path, content: operation.content });
        }
        if (completeFilesOnly && blockFiles.length) {
          blockEnvelope = { files: blockFiles, reply: operationBlocks.reply };
        }
      }
    }

    // Interpretação robusta: tenta texto direto, cada cerca JSON e o maior
    // objeto aparente. Não altera conteúdo nem tenta adivinhar JSON truncado.
    let j: any = blockEnvelope;
    if (!j) {
      const candidates = [cleaned];
      const fencedPattern = /```(?:json)?[^\S\r\n]*\r?\n([\s\S]*?)```/gi;
      let fencedMatch: RegExpExecArray | null;
      while ((fencedMatch = fencedPattern.exec(text)) !== null) {
        candidates.push(fencedMatch[1].trim());
      }
      const first = cleaned.indexOf("{");
      const last = cleaned.lastIndexOf("}");
      if (first >= 0 && last > first) candidates.push(cleaned.slice(first, last + 1));
      for (const candidate of candidates) {
        try {
          j = JSON.parse(candidate);
          break;
        } catch {}
      }
      if (!j) throw new Error("sem resposta estruturada aproveitável");
    }

    // Edição cirúrgica: aplica ops sobre os arquivos atuais (refinamento).
    if (Array.isArray(j.ops) && current && current.length) {
      const merged = applyFileOperations(current, j.ops);
      if (merged) {
        const changedFiles = normalizeFiles(j.ops);
        if (changedFiles) warnOversizedFiles(changedFiles);
        let entry =
          merged.find((f) => /(^|\/)App\.(jsx|tsx|js|ts)$/.test(f.path))?.path ?? merged[0].path;
        const app = { kind: "app" as const, name: j.name || "App", description: "", files: merged, entry, provider };
        return {
          provider,
          engineMode: "real",
          stats: projectStats(app),
          reply: String(j.reply ?? "Pronto! Arquivos atualizados."),
          plan: Array.isArray(j.plan) ? j.plan.map(String) : [],
          app,
          cost,
          model,
        };
      }
    }

    // Caminho preferido: projeto multi-arquivo com imports reais.
    const files = normalizeFiles(j.files);
    if (files) {
      warnOversizedFiles(files);
      // Descobre o entry: campo entry válido, ou App.jsx, ou o 1º arquivo.
      let entry: string =
        typeof j.entry === "string" ? j.entry.replace(/^\.?\//, "").trim() : "";
      if (!files.some((f) => f.path === entry)) {
        entry =
          files.find((f) => /(^|\/)App\.(jsx|tsx|js|ts)$/.test(f.path))?.path ?? files[0].path;
      }
      const app = { kind: "app" as const, name: j.name || "App", description: "", files, entry, provider };
      return {
        provider,
        engineMode: "real",
        stats: projectStats(app),
        reply: String(j.reply ?? "Pronto! Projeto atualizado."),
        plan: Array.isArray(j.plan) ? j.plan.map(String) : [],
        app,
        cost,
        model,
      };
    }

    // Compatibilidade: single-file legado.
    if (typeof j.code === "string" && j.code.includes("function App")) {
      warnOversizedFiles([{ path: "App.jsx", content: j.code }]);
      return {
        provider,
        engineMode: "real",
        stats: codeStats(j.code),
        reply: String(j.reply ?? "Pronto! App atualizado."),
        plan: Array.isArray(j.plan) ? j.plan.map(String) : [],
        app: { kind: "app", name: j.name || "App", description: "", code: j.code, provider },
        cost,
        model,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Estado atual do projeto para o prompt: multi-arquivo (preferido) ou single-file. */
function currentOf(a: Args): AppFile[] | string | null {
  if (a.currentFiles && a.currentFiles.length) return a.currentFiles;
  return a.currentCode ?? null;
}

/**
 * Em REFINAMENTO usa o system prompt ENXUTO (só ops → poucos tokens de saída →
 * geração rápida); na primeira geração usa o completo (design premium etc.).
 */
const INITIAL_BLOCK_TRANSPORT = `=== FORMATO FINAL DE TRANSPORTE — TEM PRIORIDADE SOBRE QUALQUER FORMATO ANTERIOR ===
Na PRIMEIRA geração, NÃO retorne JSON e NÃO coloque código em cercas Markdown. Entregue cada arquivo como texto bruto em um bloco AD_FILE:
<AD_FILE path="App.jsx" op="create">
conteúdo completo do arquivo
</AD_FILE>
<AD_FILE path="components/Exemplo.jsx" op="create">
conteúdo completo do arquivo
</AD_FILE>
Finalize opcionalmente com <AD_REPLY>resumo curto em pt-BR</AD_REPLY>.
Todos os arquivos necessários devem ser completos e autoconsistentes. App.jsx continua sendo a entrada inferida automaticamente.
ESTA REGRA SUBSTITUI qualquer instrução anterior que peça JSON para a resposta final.`;

export function providerSystemPrompt(hasCurrentProject: boolean): string {
  if (hasCurrentProject) return CODE_REFINE_SYSTEM_PROMPT;
  return `${CODE_SYSTEM_PROMPT}\n\n${INITIAL_BLOCK_TRANSPORT}`;
}

/** Contrato curto e sem instruções contraditórias para modelos gratuitos.
 * Modelos menores obedecem melhor a um único formato de transporte, enquanto
 * o plano visual e a especificação completa continuam no prompt do usuário. */
export function compactProviderSystemPrompt(hasCurrentProject: boolean): string {
  if (hasCurrentProject) return `Você é o motor de edição do AD Studio. Preserve todo o projeto atual e aplique somente o pedido recebido.
Responda APENAS com operações de texto bruto, sem JSON e sem cercas Markdown:
<AD_PATCH path="components/Arquivo.jsx"><AD_SEARCH>trecho literal, existente e único</AD_SEARCH><AD_REPLACE>trecho final</AD_REPLACE></AD_PATCH>
Use <AD_FILE path="components/Novo.jsx" op="create">arquivo completo</AD_FILE> apenas para arquivo novo, <AD_DELETE path="caminho" /> para remover e finalize com <AD_REPLY>resumo curto em pt-BR</AD_REPLY>.
Mantenha imports relativos resolvidos, React importado de 'react', Tailwind, navegação por estado e o runtime existente. Persistência é somente window.AD; atualize // AD_BACKEND ao mudar coleções. Imagens novas usam ADIMG contextual. Não invente APIs, pagamentos, vídeos ou integrações externas.`;

  return `Você é o motor de geração do AD Studio. Crie um projeto React profissional, funcional, responsivo e em pt-BR.
Responda APENAS com arquivos completos em texto bruto, sem JSON, sem explicações e sem cercas Markdown:
<AD_FILE path="App.jsx" op="create">conteúdo completo</AD_FILE>
<AD_FILE path="components/Exemplo.jsx" op="create">conteúdo completo</AD_FILE>
Finalize com <AD_REPLY>resumo curto em pt-BR</AD_REPLY>.
Regras obrigatórias: use múltiplos arquivos com imports relativos resolvidos; App.jsx fino com export default; importe React e hooks de 'react'; use Tailwind e ícones válidos; navegação por estado, sem react-router e sem window.location. Para persistência use somente window.AD e declare // AD_BACKEND em App.jsx. Imagens de conteúdo usam src="ADIMG: descrição específica em inglês". Não invente APIs, pagamentos, vídeos ou integrações externas. Entregue estados de carregamento, vazio, erro e feedback nos fluxos solicitados.`;
}

function systemPromptFor(a: Args, model = ""): string {
  if (isFreeOpenRouterModel(model)) {
    return compactProviderSystemPrompt(!!(a.currentFiles?.length || a.currentCode));
  }
  return providerSystemPrompt(!!(a.currentFiles?.length || a.currentCode));
}

/** Orçamento de saída por etapa E por modelo. Modelos baratos não herdam
 * o teto de 24k do Sonnet, evitando HTTP 402 causado só pela reserva máxima. */
export function modelOutputTokenBudget(message: string, hasCurrentProject: boolean, model: string): number {
  const isStaged = /(?:CONSTRUÇÃO|REFINAMENTO) POR ETAPAS|RECUPERAÇÃO AUTOMÁTICA/.test(message);
  if (model === BUDGET_MODEL_OPENROUTER) {
    if (isStaged && hasCurrentProject) return 2_200;
    if (isStaged) return 3_200;
    if (hasCurrentProject) return 2_500;
    return 7_000;
  }
  if (isFreeOpenRouterModel(model)) {
    if (isStaged && hasCurrentProject) return 2_600;
    if (isStaged) return 3_600;
    if (hasCurrentProject) return 2_800;
    return 7_000;
  }
  if (isStaged && hasCurrentProject) return 3_000;
  if (isStaged) return 4_500;
  if (hasCurrentProject) return 4_000;
  return 24_000;
}

function maxOutputTokens(a: Args, model: string): number {
  return modelOutputTokenBudget(a.message, !!(a.currentFiles?.length || a.currentCode), model);
}

function generationPlanFor(a: Args) {
  return buildGenerationPlan(a.message, a.mediaAssets ?? []);
}

const STAGED_RUNTIME_BLOCKERS = new Set([
  "syntax_error",
  "single_file",
  "unsafe_path",
  "duplicate_path",
  "missing_entry",
  "css_import",
  "node_import",
  "missing_import",
  "missing_default_export",
]);

/** Construções por etapas devem parar somente quando o candidato realmente não
 * pode executar. Regras de arquitetura, tamanho, mídia e acabamento continuam
 * visíveis como avisos e podem ser tratadas nas etapas seguintes. */
export function stagedRuntimeQualityReport(
  report: ProjectQualityReport,
  isStagedBuild: boolean,
  isFinalStage = false
): ProjectQualityReport {
  if (!isStagedBuild) return report;
  const finalStageBlockers = new Set(["orphan_component", "missing_auth", "missing_commercial_flow", "missing_required_section"]);
  const blocks = (code: string) => STAGED_RUNTIME_BLOCKERS.has(code) || (isFinalStage && finalStageBlockers.has(code));
  const errors = report.errors.filter((value) => blocks(value.code));
  const advisory = report.errors.filter((value) => !blocks(value.code));
  const warnings = [...report.warnings, ...advisory];
  return {
    ...report,
    valid: errors.length === 0,
    score: Math.max(0, 100 - errors.length * 20 - warnings.length * 4),
    errors,
    warnings,
  };
}

function mediaContextFor(a: Args): string {
  const assets = a.mediaAssets ?? [];
  const lines = assets.slice(0, 30).map((asset) =>
    `- ${asset.type.indexOf("video/") === 0 ? "VÍDEO" : "IMAGEM"}: ${asset.name} | ${asset.url}`
  );
  const wantsVideo = generationPlanFor(a).visualProfile.allowVideo;
  return [
    "=== CENTRAL DE MÍDIA DO PROJETO ===",
    lines.length ? lines.join("\n") : "Nenhum arquivo enviado ainda.",
    "Use uma URL acima somente quando o nome/conteúdo corresponder ao bloco. Não invente URLs, nomes de arquivo ou vídeos de demonstração.",
    wantsVideo && !assets.some((asset) => asset.type.indexOf("video/") === 0)
      ? "O usuário pediu vídeo, mas ainda não enviou um. Crie um <video src=\"\" data-ad-media=\"video\" aria-label=\"descrição contextual\" poster=\"ADIMG: contextual poster in English\" controls> responsivo, com uma mensagem visível próxima orientando a enviar o vídeo pela aba Mídia. Não use URL fictícia."
      : "Para vídeo, use exclusivamente uma URL de VÍDEO listada acima e mantenha controls, poster e aria-label.",
  ].join("\n");
}

function textPromptFor(a: Args): string {
  const generationPlan = generationPlanFor(a);
  const base = `${renderGenerationPlan(generationPlan)}\n\n${mediaContextFor(a)}\n\n${buildCodeUserPrompt(a.message, currentOf(a))}`;
  const textAttachments = (a.attachments ?? []).filter((attachment) => attachment.kind === "text");
  if (!textAttachments.length) return base;
  let remaining = 160_000;
  const blocks: string[] = [];
  for (const attachment of textAttachments) {
    if (remaining <= 0) break;
    const content = attachment.content.slice(0, remaining);
    remaining -= content.length;
    blocks.push(`--- ANEXO DO USUÁRIO: ${attachment.name} ---\n${content}\n--- FIM DO ANEXO ---`);
  }
  return `${base}\n\nUse os anexos abaixo como referência fiel para esta geração. Não invente conteúdo que contradiga os arquivos.\n\n${blocks.join("\n\n")}`;
}

function assessCandidate(result: AppGenerationResult, a: Args, repaired = false): ProjectQualityReport {
  const generationPlan = generationPlanFor(a);
  let report = validateAppProject(result.app, generationPlan, repaired);
  const isFinalStage = /(?:CONSTRUÇÃO|REFINAMENTO) POR ETAPAS\s*[—-]\s*ETAPA\s+(?:7\s+DE\s+7|3\s+DE\s+3)/i.test(a.message);

  // Um refinamento não deve ser rejeitado por uma falha antiga que ele não
  // introduziu. Só erros novos bloqueiam a edição; os antigos permanecem
  // visíveis na telemetria para uma correção futura.
  if (a.currentFiles?.length && !isFinalStage) {
    const entry = a.currentFiles.find((file) => /(^|\/)App\.(jsx|tsx|js|ts)$/.test(file.path))?.path ?? a.currentFiles[0].path;
    const baseline = validateAppProject({ kind: "app", name: a.name, description: "", files: a.currentFiles, entry }, generationPlan);
    const baselineKeys = new Set(baseline.errors.map(issueKey));
    const newErrors = report.errors.filter((value) => !baselineKeys.has(issueKey(value)));
    report.errors = newErrors;
    report.valid = newErrors.length === 0;
    report.score = Math.max(0, 100 - newErrors.length * 20 - report.warnings.length * 4);
  }

  report = stagedRuntimeQualityReport(
    report,
    /(?:CONSTRUÇÃO|REFINAMENTO) POR ETAPAS|RECUPERAÇÃO AUTOMÁTICA/.test(a.message),
    isFinalStage
  );

  result.generationPlan = generationPlan;
  result.quality = report;
  console.info("[code-engine] quality", JSON.stringify({
    provider: result.provider,
    model: result.model,
    valid: report.valid,
    score: report.score,
    repaired: report.repaired,
    errors: report.errors.map((value) => ({ code: value.code, path: value.path })),
    warnings: report.warnings.map((value) => ({ code: value.code, path: value.path })),
  }));
  return report;
}

export function qualityRepairInstruction(a: Pick<Args, "message" | "currentFiles" | "currentCode">, report: ProjectQualityReport): string {
  const failures = report.errors.map((value) => `- ${value.path ? `${value.path}: ` : ""}${value.message}`).join("\n");
  const format = a.currentFiles?.length || a.currentCode
    ? "Aplique a correção sobre o PROJETO CANDIDATO produzido pela sua resposta anterior. Reenvie somente AD_PATCH/AD_FILE/AD_DELETE necessários para corrigir os erros, seguidos de AD_REPLY. Não repita operações que já estão no candidato nem reenvie arquivos inalterados."
    : "O projeto ainda está vazio. Reenvie cada arquivo completo em blocos AD_FILE com op=\"create\", seguidos de AD_REPLY. Não use JSON, Markdown nem AD_PATCH.";
  return [
    "QUALITY GATE: o código anterior foi recusado antes de ser salvo.",
    failures,
    "Corrija somente essas falhas, preserve o escopo e confira todos os imports relativos.",
    format,
  ].join("\n\n");
}

function qualityFailureSummary(report: ProjectQualityReport): string {
  return report.errors
    .slice(0, 6)
    .map((value) => `${value.code}${value.path ? ` (${value.path})` : ""}`)
    .join(", ") || "erro estrutural não classificado";
}

/** O segundo turno do quality gate parte do candidato que acabou de ser
 * avaliado. Voltar ao snapshot anterior perde as operações válidas da etapa. */
export function qualityRepairBaseFiles(
  candidate: AppGenerationResult,
  previousFiles?: AppFile[] | null
): AppFile[] | null {
  return candidate.app.files?.length ? candidate.app.files : previousFiles ?? null;
}

/**
 * Recuperação transacional para uma etapa que deixou imports relativos
 * quebrados. Em vez de salvar um App.jsx que não executa, restaura somente os
 * arquivos ofensores que já existiam e descarta ofensores recém-criados. As
 * demais alterações válidas da etapa são preservadas.
 */
export function rollbackMissingImportFiles(
  candidate: AppGenerationResult,
  previousFiles: AppFile[],
  report: ProjectQualityReport
): AppGenerationResult | null {
  if (!report.errors.length || report.errors.some((value) => value.code !== "missing_import" || !value.path)) {
    return null;
  }

  const normalize = (path: string) => path.replace(/\\/g, "/").replace(/^\.\//, "");
  const brokenPaths = new Set(report.errors.map((value) => normalize(value.path!)));
  const previousByPath = new Map(previousFiles.map((file) => [normalize(file.path), file]));
  let changed = false;
  const files: AppFile[] = [];

  for (const file of candidate.app.files ?? []) {
    const path = normalize(file.path);
    if (!brokenPaths.has(path)) {
      files.push(file);
      continue;
    }
    const previous = previousByPath.get(path);
    if (previous) files.push({ ...previous });
    changed = true;
  }

  if (!changed || !files.length) return null;
  return {
    ...candidate,
    app: { ...candidate.app, files },
  };
}

export function recoverStagedMissingImports(candidate: AppGenerationResult, a: Args): AppGenerationResult | null {
  if (!a.currentFiles?.length || !/(?:CONSTRUÇÃO|REFINAMENTO) POR ETAPAS|RECUPERAÇÃO AUTOMÁTICA/.test(a.message)) {
    return null;
  }

  // Uma revisão não pode destruir um snapshot anterior que já cumpria todo o
  // contrato final. O rollback só é aceito depois de revalidar esse snapshot
  // com as regras completas da última etapa.
  const previousSnapshot: AppGenerationResult = {
    ...candidate,
    app: { ...candidate.app, files: a.currentFiles },
  };
  if (assessCandidate(previousSnapshot, a, true).valid) return previousSnapshot;

  let recovered = candidate;
  // Remover um arquivo novo quebrado pode expor um segundo import quebrado no
  // arquivo que o consumia; poucas passagens resolvem a cascata sem adivinhação.
  for (let pass = 0; pass < 4; pass++) {
    const quality = assessCandidate(recovered, a, true);
    if (quality.valid) return recovered;
    const next = rollbackMissingImportFiles(recovered, a.currentFiles, quality);
    if (!next) return null;
    recovered = next;
  }
  return assessCandidate(recovered, a, true).valid ? recovered : null;
}

function claudeUserContent(a: Args): any {
  const images = (a.attachments ?? []).filter((attachment) => attachment.kind === "image");
  if (!images.length) return textPromptFor(a);
  return [
    { type: "text", text: `${textPromptFor(a)}\n\nAs imagens anexadas são referências visuais do usuário. Analise composição, conteúdo e estilo ao construir ou refinar o app.` },
    ...images.map((attachment) => ({
      type: "image",
      source: {
        type: "base64",
        media_type: attachment.type,
        data: attachment.content.slice(attachment.content.indexOf(",") + 1),
      },
    })),
  ];
}

function openRouterUserContent(a: Args): any {
  const images = (a.attachments ?? []).filter((attachment) => attachment.kind === "image");
  if (!images.length) return textPromptFor(a);
  return [
    { type: "text", text: `${textPromptFor(a)}\n\nAs imagens anexadas são referências visuais do usuário. Analise composição, conteúdo e estilo ao construir ou refinar o app.` },
    ...images.map((attachment) => ({ type: "image_url", image_url: { url: attachment.content } })),
  ];
}

/** Extrai uma mensagem curta de erro do corpo de resposta de um provedor. */
async function errDetail(res: Response): Promise<string> {
  try {
    const t = await res.text();
    try {
      const j = JSON.parse(t);
      const m = j?.error?.message || j?.error || j?.message;
      if (m) return String(m).slice(0, 160);
    } catch {}
    return t.slice(0, 160);
  } catch {
    return "";
  }
}

/** Converte uma exceção de fetch em motivo legível. */
function reasonFromException(provider: string, model: string, e: any): string {
  const name = e?.name || "";
  if (name === "TimeoutError" || /timeout|aborted/i.test(String(e?.message)))
    return `${provider}: modelo ${model} não respondeu dentro do limite desta etapa.`;
  return `${provider}: falha ao chamar ${model} — ${e?.message || "erro de rede"}.`;
}

/** Limites curtos e previsíveis: uma resposta e, no máximo, um reparo dirigido. */
function providerTimeoutMs(a: Args, repair = false, model = ""): number {
  const isRefinement = !!(a.currentFiles?.length || a.currentCode);
  const isStaged = /(?:CONSTRUÇÃO|REFINAMENTO) POR ETAPAS|RECUPERAÇÃO AUTOMÁTICA/.test(a.message);
  if (isFreeOpenRouterModel(model)) {
    if (isStaged) return repair ? 45_000 : 75_000;
    if (isRefinement) return repair ? 50_000 : 80_000;
    return repair ? 60_000 : 120_000;
  }
  if (model === BUDGET_MODEL_OPENROUTER) {
    if (isStaged) return repair ? 50_000 : 90_000;
    if (isRefinement) return repair ? 50_000 : 80_000;
    return repair ? 60_000 : 150_000;
  }
  if (isStaged) return repair ? 50_000 : 80_000;
  if (isRefinement) return repair ? 60_000 : 90_000;
  if (repair) return 100_000;
  return 160_000;
}

function responseText(value: any): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (!Array.isArray(value)) return null;
  const joined = value
    .map((part) => typeof part?.text === "string" ? part.text : typeof part?.content === "string" ? part.content : "")
    .filter(Boolean)
    .join("\n");
  return joined.trim() ? joined : null;
}

export function openRouterControlsForModel(model: string): Record<string, unknown> {
  // MiMo expõe um toggle híbrido; `enabled: false` reserva o teto de completion
  // para o código final em vez de deixar o modelo consumir tudo em thinking.
  if (/^xiaomi\/mimo-v2\.5(?:$|-)/.test(model)) {
    return { reasoning: { enabled: false }, temperature: 0.2 };
  }
  if (/:free$/.test(model)) {
    return { reasoning: { enabled: false }, temperature: 0.2 };
  }
  return {};
}

/**
 * Em construções por etapas, uma falha estrutural ou timeout do primeiro modelo
 * indica que insistir na fila inteira só consumirá o restante da requisição.
 * Os fallbacks continuam disponíveis quando o modelo está indisponível por HTTP
 * (por exemplo, conta sem saldo), preservando a recuperação de infraestrutura.
 */
export function shouldTryFreeModelsAfterPaidDiagnostics(
  isStagedBuild: boolean,
  diagnostics: string[]
): boolean {
  const summary = diagnostics.join(" | ");
  const paidAnsweredButFailed = /quality gate|gerou c[oó]digo estruturalmente inv[aá]lido|n[aã]o passou|resposta inicial .* n[aã]o p[oô]de ser aplicada|continuou inv[aá]lida/i.test(summary);
  if (paidAnsweredButFailed) return false;
  if (!isStagedBuild) return true;
  if (/n[aã]o respondeu dentro/i.test(summary)) return false;
  return /HTTP (?:401|402|404|408|429|5\d\d)\b/i.test(summary);
}

function openRouterEmptyResponseSummary(data: any): string {
  const choice = data?.choices?.[0];
  const message = choice?.message;
  const usage = data?.usage ?? {};
  const reasoningText = responseText(message?.reasoning);
  const reasoningDetails = Array.isArray(message?.reasoning_details) ? message.reasoning_details : [];
  const reasoningChars = reasoningText?.length ?? JSON.stringify(reasoningDetails).length;
  const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens
    ?? usage?.completionTokensDetails?.reasoningTokens
    ?? "?";
  return [
    `finish=${choice?.finish_reason ?? "?"}`,
    `completion_tokens=${usage?.completion_tokens ?? usage?.completionTokens ?? "?"}`,
    `reasoning_tokens=${reasoningTokens}`,
    `reasoning_chars=${reasoningChars}`,
  ].join(", ");
}

function responseFormatSummary(text: string): string {
  const markers = [
    /<AD_PATCH\b/i.test(text) ? "AD_PATCH" : "",
    /<AD_FILE\b/i.test(text) ? "AD_FILE" : "",
    /```/.test(text) ? "markdown" : "",
    /\{/.test(text) ? "json-like" : "",
  ].filter(Boolean);
  return `${text.length} caracteres; formato ${markers.join("+") || "texto"}`;
}

/** Segunda passagem usada somente quando um refinamento veio com conteúdo útil,
 * mas fora do JSON ops exigido. Mantém a correção no mesmo modelo forte e evita
 * descartar uma edição por cerca Markdown, aspas ou quebras não escapadas. */
function formatRepairInstruction(hasCurrentProject: boolean): string {
  return [
    "A resposta anterior não pôde ser aplicada no projeto.",
    "Reenvie a MESMA alteração, sem ampliar o escopo e sem usar JSON.",
    hasCurrentProject
      ? "Para arquivo existente, use <AD_PATCH path=\"caminho.jsx\"><AD_SEARCH>trecho literal e único do arquivo atual</AD_SEARCH><AD_REPLACE>novo trecho bruto</AD_REPLACE></AD_PATCH>. Para arquivo novo use <AD_FILE path=\"caminho.jsx\" op=\"create\">conteúdo completo</AD_FILE>. Para remover use <AD_DELETE path=\"caminho.jsx\" />."
      : "O projeto ainda está vazio. Reenvie cada arquivo completo em <AD_FILE path=\"caminho.jsx\" op=\"create\">conteúdo bruto</AD_FILE>. Não use AD_PATCH.",
    "Finalize com <AD_REPLY>resumo curto em pt-BR</AD_REPLY>. Não use explicações fora desses blocos e não reenvie arquivos inalterados.",
  ].join("\n\n");
}

async function callClaude(apiKey: string, a: Args, model: string, diag: string[]): Promise<AppGenerationResult | null> {
  try {
    const initialMessages = [{ role: "user", content: claudeUserContent(a) }];
    const send = (messages: any[], timeoutMs = providerTimeoutMs(a, false, model)) => fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: maxOutputTokens(a, model),
        system: systemPromptFor(a),
        messages,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const res = await send(initialMessages);
    if (!res.ok) {
      diag.push(`Claude: modelo ${model} → HTTP ${res.status}${res.status === 401 ? " (chave rejeitada)" : ""}. ${await errDetail(res)}`);
      return null;
    }
    const data = await res.json();
    const text = responseText(data?.content?.[0]?.text ?? data?.content);
    const cost = estimateCost(model, data?.usage?.input_tokens ?? 0, data?.usage?.output_tokens ?? 0);
    if (!text) { diag.push(`Claude: ${model} respondeu vazio.`); return null; }
    const r = parse(text, "claude", cost, model, a.currentFiles ?? null);
    if (r) {
      const quality = assessCandidate(r, a);
      if (quality.valid) return r;
      diag.push(`Claude: ${model} gerou código estruturalmente inválido [${qualityFailureSummary(quality)}]; quality gate iniciou uma correção.`);
      const qualityRes = await send([
        ...initialMessages,
        { role: "assistant", content: text.slice(0, 100_000) },
        { role: "user", content: qualityRepairInstruction(a, quality) },
      ], providerTimeoutMs(a, true, model));
      if (!qualityRes.ok) {
        diag.push(`Claude: correção estrutural com ${model} → HTTP ${qualityRes.status}. ${await errDetail(qualityRes)}`);
        return null;
      }
      const qualityData = await qualityRes.json();
      const qualityText = responseText(qualityData?.content?.[0]?.text ?? qualityData?.content);
      const qualityCost = estimateCost(model, qualityData?.usage?.input_tokens ?? 0, qualityData?.usage?.output_tokens ?? 0);
      // A segunda resposta corrige o candidato imediatamente anterior. Aplicar
      // esses patches sobre o snapshot original descartava arquivos recém-
      // criados na etapa e fazia o mesmo quality gate falhar novamente.
      const corrected = qualityText ? parse(qualityText, "claude", cost + qualityCost, model, qualityRepairBaseFiles(r, a.currentFiles)) : null;
      const correctedQuality = corrected ? assessCandidate(corrected, a, true) : null;
      if (corrected && correctedQuality?.valid) return corrected;
      const recovered = recoverStagedMissingImports(corrected ?? r, a);
      if (recovered) {
        diag.push(`Claude: ${model} teve apenas arquivos com imports quebrados revertidos; alterações válidas da etapa foram preservadas.`);
        return recovered;
      }
      diag.push(`Claude: ${model} não passou no quality gate após uma correção automática${correctedQuality ? ` [${qualityFailureSummary(correctedQuality)}]` : ""}.`);
      return null;
    }

    const isRefinement = !!(a.currentFiles?.length || a.currentCode);
    // Toda resposta não vazia recebe UMA correção de transporte antes de desistirmos;
    // repetir a geração inteira duplica custo e latência sem atacar a causa.
    diag.push(`Claude: resposta inicial de ${model} não pôde ser aplicada; recuperação de formato iniciada.`);
    const repairRes = await send([
      ...initialMessages,
      { role: "assistant", content: text.slice(0, 60_000) },
      { role: "user", content: formatRepairInstruction(isRefinement) },
    ], providerTimeoutMs(a, true, model));
    if (!repairRes.ok) {
      diag.push(`Claude: recuperação com ${model} → HTTP ${repairRes.status}. ${await errDetail(repairRes)}`);
      return null;
    }
    const repairData = await repairRes.json();
    const repairText = responseText(repairData?.content?.[0]?.text ?? repairData?.content);
    const repairCost = estimateCost(model, repairData?.usage?.input_tokens ?? 0, repairData?.usage?.output_tokens ?? 0);
    if (!repairText) {
      diag.push(`Claude: recuperação com ${model} respondeu vazia.`);
      return null;
    }
    const repaired = parse(repairText, "claude", cost + repairCost, model, a.currentFiles ?? null);
    if (repaired && !assessCandidate(repaired, a, true).valid) {
      diag.push(`Claude: resposta de ${model} foi interpretada, mas falhou no quality gate após a recuperação.`);
      return null;
    }
    if (!repaired) diag.push(`Claude: resposta de ${model} continuou inválida após a recuperação automática (${responseFormatSummary(repairText)}).`);
    return repaired;
  } catch (e) {
    diag.push(reasonFromException("Claude", model, e));
    return null;
  }
}

async function callOpenRouter(apiKey: string, a: Args, model: string, diag: string[]): Promise<AppGenerationResult | null> {
  try {
    const initialMessages = [
      { role: "system", content: systemPromptFor(a, model) },
      { role: "user", content: openRouterUserContent(a) },
    ];
    const send = (messages: any[], timeoutMs = providerTimeoutMs(a, false, model)) => fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: maxOutputTokens(a, model),
        usage: { include: true },
        messages,
      ...openRouterControlsForModel(model),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const res = await send(initialMessages);
    if (!res.ok) {
      const detail = await errDetail(res);
      const hint =
        res.status === 404 ? " — modelo indisponível/renomeado no OpenRouter" :
        res.status === 401 ? " — chave rejeitada" :
        res.status === 402 ? " — sem crédito/saldo" : "";
      diag.push(`OpenRouter: modelo ${model} → HTTP ${res.status}${hint}. ${detail}`);
      return null;
    }
    const data = await res.json();
    const text = responseText(data?.choices?.[0]?.message?.content);
    // OpenRouter devolve usage.cost (USD) quando disponível.
    const cost =
      typeof data?.usage?.cost === "number"
        ? data.usage.cost
        : estimateCost(model, data?.usage?.prompt_tokens ?? 0, data?.usage?.completion_tokens ?? 0);
    if (!text) {
      diag.push(`OpenRouter: ${model} respondeu vazio (${openRouterEmptyResponseSummary(data)}).`);
      return null;
    }
    const r = parse(text, "openrouter", cost, model, a.currentFiles ?? null);
    if (r) {
      const quality = assessCandidate(r, a);
      if (quality.valid) return r;
      diag.push(`OpenRouter: ${model} gerou código estruturalmente inválido [${qualityFailureSummary(quality)}]; quality gate iniciou uma correção.`);
      const qualityRes = await send([
        ...initialMessages,
        { role: "assistant", content: text.slice(0, 100_000) },
        { role: "user", content: qualityRepairInstruction(a, quality) },
      ], providerTimeoutMs(a, true, model));
      if (!qualityRes.ok) {
        diag.push(`OpenRouter: correção estrutural com ${model} → HTTP ${qualityRes.status}. ${await errDetail(qualityRes)}`);
        return null;
      }
      const qualityData = await qualityRes.json();
      const qualityText = responseText(qualityData?.choices?.[0]?.message?.content);
      const qualityCost = typeof qualityData?.usage?.cost === "number"
        ? qualityData.usage.cost
        : estimateCost(model, qualityData?.usage?.prompt_tokens ?? 0, qualityData?.usage?.completion_tokens ?? 0);
      // O reparo é incremental sobre o candidato, não sobre o snapshot anterior
      // à geração. Assim um patch pode corrigir também um arquivo criado agora.
      const corrected = qualityText ? parse(qualityText, "openrouter", cost + qualityCost, model, qualityRepairBaseFiles(r, a.currentFiles)) : null;
      const correctedQuality = corrected ? assessCandidate(corrected, a, true) : null;
      if (corrected && correctedQuality?.valid) return corrected;
      const recovered = recoverStagedMissingImports(corrected ?? r, a);
      if (recovered) {
        diag.push(`OpenRouter: ${model} teve apenas arquivos com imports quebrados revertidos; alterações válidas da etapa foram preservadas.`);
        return recovered;
      }
      diag.push(`OpenRouter: ${model} não passou no quality gate após uma correção automática${correctedQuality ? ` [${qualityFailureSummary(correctedQuality)}]` : ""}.`);
      return null;
    }

    const isRefinement = !!(a.currentFiles?.length || a.currentCode);
    // Toda resposta não vazia recebe UMA correção de transporte antes de desistirmos;
    // repetir a geração inteira duplica custo e latência sem atacar a causa.
    diag.push(`OpenRouter: resposta inicial de ${model} não pôde ser aplicada; recuperação de formato iniciada.`);
    const repairRes = await send([
      ...initialMessages,
      { role: "assistant", content: text.slice(0, 60_000) },
      { role: "user", content: formatRepairInstruction(isRefinement) },
    ], providerTimeoutMs(a, true, model));
    if (!repairRes.ok) {
      const detail = await errDetail(repairRes);
      diag.push(`OpenRouter: recuperação com ${model} → HTTP ${repairRes.status}. ${detail}`);
      return null;
    }
    const repairData = await repairRes.json();
    const repairText = responseText(repairData?.choices?.[0]?.message?.content);
    const repairCost =
      typeof repairData?.usage?.cost === "number"
        ? repairData.usage.cost
        : estimateCost(model, repairData?.usage?.prompt_tokens ?? 0, repairData?.usage?.completion_tokens ?? 0);
    if (!repairText) {
      diag.push(`OpenRouter: recuperação com ${model} respondeu vazia.`);
      return null;
    }
    const repaired = parse(repairText, "openrouter", cost + repairCost, model, a.currentFiles ?? null);
    if (repaired && !assessCandidate(repaired, a, true).valid) {
      diag.push(`OpenRouter: resposta de ${model} foi interpretada, mas falhou no quality gate após a recuperação.`);
      return null;
    }
    if (!repaired) diag.push(`OpenRouter: resposta de ${model} continuou inválida após a recuperação automática (${responseFormatSummary(repairText)}).`);
    return repaired;
  } catch (e) {
    diag.push(reasonFromException("OpenRouter", model, e));
    return null;
  }
}

function demoFallback(message: string, failureReason?: string): AppGenerationResult {
  const code = `
function App(){
  const [n, setN] = useState(0);
  return React.createElement('div',{className:'min-h-full flex flex-col items-center justify-center gap-5 p-8 bg-slate-900 text-white text-center'},
    React.createElement('div',{className:'text-xs uppercase tracking-widest text-indigo-400'},'AD Studio · modo demo'),
    React.createElement('h1',{className:'text-2xl font-bold max-w-md'},'Para gerar QUALQUER app a partir do seu texto, conecte uma chave de IA em Configurações'),
    React.createElement('p',{className:'text-slate-400 max-w-md text-sm'},'Sem chave, o AD Studio executa apps prontos (jogo da velha, calculadora, lista de tarefas, pomodoro) e este exemplo abaixo.'),
    React.createElement('div',{className:'mt-2 flex items-center gap-3'},
      React.createElement('button',{onClick:function(){setN(n-1);},className:'w-10 h-10 rounded-lg bg-slate-700 hover:bg-slate-600 text-xl'},'-'),
      React.createElement('span',{className:'text-4xl font-bold tabular-nums w-16'},String(n)),
      React.createElement('button',{onClick:function(){setN(n+1);},className:'w-10 h-10 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-xl'},'+')
    )
  );
}`;
  return {
    provider: "demo",
    engineMode: "demo",
    stats: codeStats(code),
    reply:
      "⚠️ MODO DEMO — nenhuma IA está conectada, então este NÃO é código gerado a partir do seu pedido: é um app de demonstração fixo. Conecte uma chave de IA em Configurações para gerar de verdade.",
    plan: ["Verificar provedor de IA", "Nenhuma chave encontrada", "Carregar app de DEMONSTRAÇÃO (não é geração real)"],
    app: { kind: "app", name: message.slice(0, 40) || "App", description: "", code, provider: "demo" },
    cost: 0,
    model: "demo",
    failureReason,
  };
}

export async function generateAppWithProviders(a: Args): Promise<AppGenerationResult> {
  const isRefinement = !!(a.currentFiles?.length || a.currentCode);
  const isStagedBuild = /(?:CONSTRUÇÃO|REFINAMENTO) POR ETAPAS|RECUPERAÇÃO AUTOMÁTICA/.test(a.message);
  const functionalRefinement = isRefinement && isFunctionalRefinement(a.message);
  const premiumOnly = isStagedBuild || functionalRefinement;
  // Um superprompt já foi dividido justamente para preservar qualidade. Nestas
  // etapas — e em mudanças funcionais de navegação, botões, fluxo ou correção —
  // o modo econômico não pode substituir o modelo forte silenciosamente.
  const tier = premiumOnly
    ? "premium"
    : pickTier(a.costMode ?? "auto", { isApp: true, isRefinement, message: a.message });
  // Coletor de motivos técnicos de falha (para dar um erro honesto, não genérico).
  const diag: string[] = [];
  const hadKey = !!(a.userKey || process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY);

  // ── AUTO-CURA PREVISÍVEL ──────────────────────────────────────────────────
  // Repetimos falhas transitórias e podemos tentar outra chave/provedor, mas
  // preservamos o tier escolhido. Nunca rebaixamos Premium para Haiku nem
  // elevamos Econômico para Premium sem uma nova escolha do usuário.
  async function tryChain(
    provider: "claude" | "openrouter",
    key: string,
    call: (k: string, args: Args, model: string, d: string[]) => Promise<AppGenerationResult | null>
  ): Promise<AppGenerationResult | null> {
    const chain = modelExecutionPlan(tier, provider);
    const chainDiagnosticsStart = diag.length;
    for (let i = 0; i < chain.length; i++) {
      if (provider === "openrouter" && i > 0 && !shouldTryFreeModelsAfterPaidDiagnostics(
        isStagedBuild,
        diag.slice(chainDiagnosticsStart)
      )) {
        diag.push("OpenRouter: fallbacks adicionais foram ignorados nesta etapa para preservar o prazo da requisição.");
        break;
      }
      // Cada chamada já inclui no máximo uma passagem dirigida de quality/format repair.
      // Repetir toda a geração mascarava a causa e duplicava custo/latência.
      const attempts = 1;
      for (let t = 0; t < attempts; t++) {
        const r = await call(key, a, chain[i], diag);
        if (r) return r;
      }
    }
    return null;
  }

  // 1) chave do usuário
  if (a.userKey && a.userProvider === "claude") {
    const r = await tryChain("claude", a.userKey, callClaude);
    if (r) return r;
  }
  if (a.userKey && a.userProvider === "openrouter") {
    const r = await tryChain("openrouter", a.userKey, callOpenRouter);
    if (r) return r;
  }
  // 2/3) ambiente. Em refinamento, uma chave explicitamente escolhida é a
  // autoridade: repetir a chamada com chaves do servidor só duplica tempo/custo
  // e pode consumir todo o prazo antes de devolver um diagnóstico útil.
  const explicitProvider = !!a.userKey && (a.userProvider === "claude" || a.userProvider === "openrouter");
  const allowEnvironmentFallback = !explicitProvider || !isRefinement;
  const repeatedAnthropicKey = a.userProvider === "claude" && a.userKey === process.env.ANTHROPIC_API_KEY;
  const repeatedOpenRouterKey = a.userProvider === "openrouter" && a.userKey === process.env.OPENROUTER_API_KEY;
  if (allowEnvironmentFallback && !repeatedAnthropicKey && process.env.ANTHROPIC_API_KEY && a.userProvider !== "local") {
    const r = await tryChain("claude", process.env.ANTHROPIC_API_KEY, callClaude);
    if (r) return r;
  }
  if (allowEnvironmentFallback && !repeatedOpenRouterKey && process.env.OPENROUTER_API_KEY && a.userProvider !== "local") {
    const r = await tryChain("openrouter", process.env.OPENROUTER_API_KEY, callOpenRouter);
    if (r) return r;
  }
  // Em MODO REAL forçado, nunca entregamos template/demo disfarçado:
  // devolvemos o demo explícito e a rota converte em erro claro (needsKey).
  if (a.forceReal) {
    // Se havia chave mas a IA falhou, o motivo real é a última falha coletada —
    // não é "nenhuma IA conectada". Se não havia chave, aí sim é falta de chave.
    const reason = hadKey && diag.length ? diag.join(" | ") : undefined;
    return demoFallback(a.message, reason);
  }

  // 4) template enlatado (só na primeira geração, quando permitido)
  if (!isRefinement && a.allowTemplate) {
    const t = matchTemplate(a.message);
    if (t) {
      return {
        provider: "template",
        engineMode: "template",
        stats: codeStats(t.code),
        reply: `📦 TEMPLATE PRONTO (não é geração por IA): ${t.reply}`,
        plan: t.plan,
        app: { kind: "app", name: t.name, description: "", code: t.code, provider: "template" },
        cost: 0,
        model: "template",
      };
    }
  }
  return demoFallback(a.message, hadKey && diag.length ? diag.join(" | ") : undefined);
}
