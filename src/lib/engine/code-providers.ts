/**
 * Provedores de geração de CÓDIGO (server-only) — o núcleo do clone do Lovable.
 *
 * Ordem: chave do usuário → ANTHROPIC_API_KEY → OPENROUTER_API_KEY → template.
 * Com roteamento de modelo (econômico/premium) e captura de custo real, para
 * o Studio operar barato.
 */
import { AppFile, AppGenerationResult, ProjectQualityReport, codeStats, projectStats } from "./app-types";
import { CODE_SYSTEM_PROMPT, CODE_REFINE_SYSTEM_PROMPT, buildCodeUserPrompt } from "./code-prompts";
import { matchTemplate } from "./code-templates";
import { CostMode, pickTier, modelFor, estimateCost, isFunctionalRefinement } from "./models";
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
    const operationBlocks = current?.length ? parseOperationBlocks(text) : null;
    const cleaned = text.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
    // Interpretação ROBUSTA: tenta o texto direto; se falhar (o modelo às vezes
    // manda uma frase antes/depois do JSON, ou cerca a mais), isola do primeiro
    // "{" até o último "}" e tenta de novo. Assim uma resposta boa não é
    // descartada só por causa de texto em volta.
    let j: any = operationBlocks;
    if (!j) {
      try {
        j = JSON.parse(cleaned);
      } catch {
        const first = cleaned.indexOf("{");
        const last = cleaned.lastIndexOf("}");
        if (first < 0 || last <= first) throw new Error("sem objeto JSON");
        j = JSON.parse(cleaned.slice(first, last + 1));
      }
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
function systemPromptFor(a: Args): string {
  return a.currentFiles?.length || a.currentCode ? CODE_REFINE_SYSTEM_PROMPT : CODE_SYSTEM_PROMPT;
}

/** Não reserva 24k tokens no OpenRouter para uma etapa que foi deliberadamente
 * limitada a poucos arquivos. O provedor valida o saldo contra o máximo pedido,
 * então um teto proporcional evita HTTP 402 prematuro e controla o custo. */
function maxOutputTokens(a: Args): number {
  const isRefinement = !!(a.currentFiles?.length || a.currentCode);
  const isStaged = /(?:CONSTRUÇÃO|REFINAMENTO) POR ETAPAS|RECUPERAÇÃO AUTOMÁTICA/.test(a.message);
  if (isStaged && isRefinement) return 6_000;
  if (isStaged) return 12_000;
  // Refinamentos comuns agora usam patches curtos. Reservar 8k tokens fazia o
  // OpenRouter recusar pedidos por saldo mesmo quando a resposta precisava de
  // poucas centenas de tokens.
  if (isRefinement) return 4_000;
  return 24_000;
}

function textPromptFor(a: Args): string {
  const generationPlan = buildGenerationPlan(a.message);
  const base = `${renderGenerationPlan(generationPlan)}\n\n${buildCodeUserPrompt(a.message, currentOf(a))}`;
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
  const generationPlan = buildGenerationPlan(a.message);
  const report = validateAppProject(result.app, generationPlan, repaired);

  // Um refinamento não deve ser rejeitado por uma falha antiga que ele não
  // introduziu. Só erros novos bloqueiam a edição; os antigos permanecem
  // visíveis na telemetria para uma correção futura.
  if (a.currentFiles?.length) {
    const entry = a.currentFiles.find((file) => /(^|\/)App\.(jsx|tsx|js|ts)$/.test(file.path))?.path ?? a.currentFiles[0].path;
    const baseline = validateAppProject({ kind: "app", name: a.name, description: "", files: a.currentFiles, entry }, generationPlan);
    const baselineKeys = new Set(baseline.errors.map(issueKey));
    const newErrors = report.errors.filter((value) => !baselineKeys.has(issueKey(value)));
    report.errors = newErrors;
    report.valid = newErrors.length === 0;
    report.score = Math.max(0, 100 - newErrors.length * 20 - report.warnings.length * 4);
  }

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

function qualityRepairInstruction(a: Args, report: ProjectQualityReport): string {
  const failures = report.errors.map((value) => `- ${value.path ? `${value.path}: ` : ""}${value.message}`).join("\n");
  const format = a.currentFiles?.length || a.currentCode
    ? "Reenvie somente AD_PATCH/AD_FILE/AD_DELETE válidos contra o projeto original, seguidos de AD_REPLY."
    : "Reenvie o projeto completo no JSON files obrigatório, sem Markdown nem texto fora do JSON.";
  return [
    "QUALITY GATE: o código anterior foi recusado antes de ser salvo.",
    failures,
    "Corrija somente essas falhas, preserve o escopo e confira todos os imports relativos.",
    format,
  ].join("\n\n");
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

/** Mantém espaço para a rota finalizar e para uma tentativa reduzida da etapa. */
function providerTimeoutMs(a: Args, repair = false): number {
  const isRefinement = !!(a.currentFiles?.length || a.currentCode);
  const isStaged = /(?:CONSTRUÇÃO|REFINAMENTO) POR ETAPAS|RECUPERAÇÃO AUTOMÁTICA/.test(a.message);
  if (isStaged) return repair ? 45_000 : 75_000;
  if (isRefinement) return repair ? 60_000 : 90_000;
  return 120_000;
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
function formatRepairInstruction(): string {
  return [
    "A resposta anterior não pôde ser aplicada no projeto.",
    "Reenvie a MESMA alteração, sem ampliar o escopo e sem usar JSON.",
    "Para arquivo existente, use <AD_PATCH path=\"caminho.jsx\"><AD_SEARCH>trecho literal e único do arquivo atual</AD_SEARCH><AD_REPLACE>novo trecho bruto</AD_REPLACE></AD_PATCH>. Para arquivo novo use <AD_FILE path=\"caminho.jsx\" op=\"create\">conteúdo completo</AD_FILE>. Para remover use <AD_DELETE path=\"caminho.jsx\" />.",
    "Finalize com <AD_REPLY>resumo curto em pt-BR</AD_REPLY>. Não use explicações fora desses blocos e não reenvie arquivos inalterados.",
  ].join("\n\n");
}

async function callClaude(apiKey: string, a: Args, model: string, diag: string[]): Promise<AppGenerationResult | null> {
  try {
    const initialMessages = [{ role: "user", content: claudeUserContent(a) }];
    const send = (messages: any[], timeoutMs = providerTimeoutMs(a)) => fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: maxOutputTokens(a),
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
      diag.push(`Claude: ${model} gerou código estruturalmente inválido; quality gate iniciou uma correção.`);
      const qualityRes = await send([
        ...initialMessages,
        { role: "assistant", content: text.slice(0, 100_000) },
        { role: "user", content: qualityRepairInstruction(a, quality) },
      ], providerTimeoutMs(a, true));
      if (!qualityRes.ok) {
        diag.push(`Claude: correção estrutural com ${model} → HTTP ${qualityRes.status}. ${await errDetail(qualityRes)}`);
        return null;
      }
      const qualityData = await qualityRes.json();
      const qualityText = responseText(qualityData?.content?.[0]?.text ?? qualityData?.content);
      const qualityCost = estimateCost(model, qualityData?.usage?.input_tokens ?? 0, qualityData?.usage?.output_tokens ?? 0);
      const corrected = qualityText ? parse(qualityText, "claude", cost + qualityCost, model, a.currentFiles ?? null) : null;
      if (corrected && assessCandidate(corrected, a, true).valid) return corrected;
      diag.push(`Claude: ${model} não passou no quality gate após uma correção automática.`);
      return null;
    }

    const isRefinement = !!(a.currentFiles?.length || a.currentCode);
    const shouldRepair = isRefinement;
    if (!shouldRepair) {
      diag.push(`Claude: resposta de ${model} não pôde ser interpretada como código (${responseFormatSummary(text)}).`);
      return null;
    }

    diag.push(`Claude: resposta inicial de ${model} não pôde ser aplicada; recuperação de formato iniciada.`);
    const repairRes = await send([
      ...initialMessages,
      { role: "assistant", content: text.slice(0, 60_000) },
      { role: "user", content: formatRepairInstruction() },
    ], providerTimeoutMs(a, true));
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
      { role: "system", content: systemPromptFor(a) },
      { role: "user", content: openRouterUserContent(a) },
    ];
    const send = (messages: any[], timeoutMs = providerTimeoutMs(a)) => fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: maxOutputTokens(a),
        usage: { include: true },
        messages,
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
    if (!text) { diag.push(`OpenRouter: ${model} respondeu vazio.`); return null; }
    const r = parse(text, "openrouter", cost, model, a.currentFiles ?? null);
    if (r) {
      const quality = assessCandidate(r, a);
      if (quality.valid) return r;
      diag.push(`OpenRouter: ${model} gerou código estruturalmente inválido; quality gate iniciou uma correção.`);
      const qualityRes = await send([
        ...initialMessages,
        { role: "assistant", content: text.slice(0, 100_000) },
        { role: "user", content: qualityRepairInstruction(a, quality) },
      ], providerTimeoutMs(a, true));
      if (!qualityRes.ok) {
        diag.push(`OpenRouter: correção estrutural com ${model} → HTTP ${qualityRes.status}. ${await errDetail(qualityRes)}`);
        return null;
      }
      const qualityData = await qualityRes.json();
      const qualityText = responseText(qualityData?.choices?.[0]?.message?.content);
      const qualityCost = typeof qualityData?.usage?.cost === "number"
        ? qualityData.usage.cost
        : estimateCost(model, qualityData?.usage?.prompt_tokens ?? 0, qualityData?.usage?.completion_tokens ?? 0);
      const corrected = qualityText ? parse(qualityText, "openrouter", cost + qualityCost, model, a.currentFiles ?? null) : null;
      if (corrected && assessCandidate(corrected, a, true).valid) return corrected;
      diag.push(`OpenRouter: ${model} não passou no quality gate após uma correção automática.`);
      return null;
    }

    const isRefinement = !!(a.currentFiles?.length || a.currentCode);
    const shouldRepair = isRefinement;
    if (!shouldRepair) {
      diag.push(`OpenRouter: resposta de ${model} não pôde ser interpretada como código (${responseFormatSummary(text)}).`);
      return null;
    }

    diag.push(`OpenRouter: resposta inicial de ${model} não pôde ser aplicada; recuperação de formato iniciada.`);
    const repairRes = await send([
      ...initialMessages,
      { role: "assistant", content: text.slice(0, 60_000) },
      { role: "user", content: formatRepairInstruction() },
    ], providerTimeoutMs(a, true));
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

  // ── AUTO-CURA (comportamento tipo Lovable) ────────────────────────────────
  // Para cada provedor, tentamos o modelo escolhido e, se falhar (modelo fora do
  // ar, resposta truncada, erro transitório), caímos AUTOMATICAMENTE para o
  // outro modelo — o principal com 1 retry. Assim uma falha pontual vira
  // conserto automático em vez de um beco sem saída.
  async function tryChain(
    provider: "claude" | "openrouter",
    key: string,
    call: (k: string, args: Args, model: string, d: string[]) => Promise<AppGenerationResult | null>
  ): Promise<AppGenerationResult | null> {
    const primary = modelFor(tier, provider);
    const secondary = modelFor(tier === "premium" ? "economy" : "premium", provider);
    // Superprompts e alterações funcionais permanecem no Premium. Cair para
    // Haiku escondido reduz qualidade e torna o diagnóstico enganoso.
    const chain = premiumOnly || primary === secondary ? [primary] : [primary, secondary];
    for (let i = 0; i < chain.length; i++) {
      // Refinamento: 1 tentativa no principal (rápido, cabe nos 60s do Hobby).
      // Primeira geração: 2 tentativas (mais robusto, vale a espera).
      const attempts = premiumOnly ? 1 : i === 0 && !isRefinement ? 2 : 1;
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
  if (allowEnvironmentFallback && process.env.ANTHROPIC_API_KEY && a.userProvider !== "local") {
    const r = await tryChain("claude", process.env.ANTHROPIC_API_KEY, callClaude);
    if (r) return r;
  }
  if (allowEnvironmentFallback && process.env.OPENROUTER_API_KEY && a.userProvider !== "local") {
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
