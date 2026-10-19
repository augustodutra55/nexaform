/**
 * Roteamento de modelos por complexidade — o coração da economia do Studio.
 *
 * Tarefas simples (sites, copy, landing, FAQ, ajustes leves) usam um modelo
 * BARATO; tarefas complexas (apps com lógica, jogos, componentes interativos)
 * usam um modelo FORTE. O usuário pode forçar "econômico" ou "premium".
 *
 * Os nomes de modelo são os do OpenRouter (provider/modelo) e podem ser
 * sobrescritos por env. Para a Anthropic direta, mapeamos para o id equivalente.
 */

export type CostMode = "auto" | "economy" | "premium";
export type Tier = "economy" | "premium";

/** Alterações que mudam comportamento não devem ser tratadas como copy/estilo.
 * Mesmo quando o pedido é curto, navegação, botões e correções exigem o modelo
 * forte para preservar o restante de um app multi-arquivo. */
export function isFunctionalRefinement(message: string): boolean {
  return /\b(?:voltar|retornar|p[aá]gina anterior|tela anterior|seta|navega(?:r|[çc][aã]o)|menu|rota|link|bot[aã]o|clique|clicar|a[çc][aã]o|n[aã]o funciona|funcionalidade|erro|bug|corrig(?:ir|a)|consert(?:ar|e)|quebr(?:ou|ado|ar)|fluxo|formul[aá]rio|salvar|excluir|cadastro|login|senha|autentica[çc][aã]o|permiss[aã]o|validar|valida[çc][aã]o|c[aá]lculo|filtro|busca|pesquisa|estado|modal|toast|api|integra[çc][aã]o|upload|download|[aá]udio|microfone|voz|som)\b/i.test(message);
}

/** Modelo OpenRouter barato — bom para copy/estrutura/sites. */
export const ECON_MODEL_OPENROUTER = process.env.NEXT_PUBLIC_ECON_MODEL || "anthropic/claude-haiku-5.5";
/**
 * Alias oficial do OpenRouter para o Sonnet atual. Usar o alias evita que o
 * motor fique preso a um snapshot retirado do catálogo, como ocorreu com 4.5.
 */
export const PREMIUM_MODEL_OPENROUTER = process.env.NEXT_PUBLIC_PREMIUM_MODEL || "~anthropic/claude-sonnet-latest";
/**
 * Modelos fortes de fornecedores diferentes. São usados somente se o Sonnet
 * atual falhar por indisponibilidade, limite ou erro 5xx; continuam sujeitos ao
 * mesmo parser e quality gate do modelo principal.
 */
const DEFAULT_PREMIUM_FALLBACK_MODELS_OPENROUTER = [
  "openai/gpt-6.1-sol",
  "google/gemini-4-argon",
];

export const PREMIUM_FALLBACK_MODELS_OPENROUTER = uniqueModels(
  String(process.env.OPENROUTER_PREMIUM_FALLBACK_MODELS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean)
    .concat(DEFAULT_PREMIUM_FALLBACK_MODELS_OPENROUTER)
);
/**
 * Fallbacks de orçamento do OpenRouter. Mantemos o Claude escolhido como primeira
 * opção. MiMo V2.5 é multimodal, muito barato e amplamente usado para coding;
 * o roteador free permanece apenas como última tentativa sem saldo pago.
 */
export const BUDGET_MODEL_OPENROUTER = process.env.NEXT_PUBLIC_BUDGET_MODEL || "xiaomi/mimo-v2.5";
export const FREE_MODEL_OPENROUTER = "openrouter/free";
/** Modelos gratuitos concretos, ordenados por capacidade atual de programação.
 * A lista pode ser atualizada na Vercel sem alterar código quando a oferta do
 * OpenRouter mudar. O roteador aleatório continua como último recurso. */
const DEFAULT_FREE_CODING_MODELS_OPENROUTER = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "google/gemma-4-31b-it:free",
  "cohere/north-mini-code:free",
];

export const FREE_CODING_MODELS_OPENROUTER = uniqueModels(
  String(process.env.OPENROUTER_FREE_MODELS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean)
    .concat(DEFAULT_FREE_CODING_MODELS_OPENROUTER)
);

export function isFreeOpenRouterModel(model: string): boolean {
  return model === FREE_MODEL_OPENROUTER || /:free$/.test(model);
}

/** Equivalentes para a API direta da Anthropic. */
export const ECON_MODEL_ANTHROPIC = "claude-haiku-5-5";
export const PREMIUM_MODEL_ANTHROPIC = "claude-sonnet-5-5";


export function pickTier(
  mode: CostMode,
  opts: { isApp?: boolean; isRefinement?: boolean; message?: string }
): Tier {
  if (mode === "economy") return "economy";
  if (mode === "premium") return "premium";

  const m = (opts.message || "").toLowerCase();
  const complex =
    /\b(l[óo]gica|interativ|jogo|jogar|game|algoritmo|c[áa]lcul|state|drag|arrast|anima[çc][ãa]o|valida|integra|api|gr[áa]fico complexo|multi.?etapa|fluxo)\b/.test(
      m
    );
  const lightEdit = /\b(troque|mude|ajuste|cor|texto|t[íi]tulo|fonte|espa[çc]|tom|remova|adicione uma se[çc][ãa]o)\b/.test(m);

  // Apps são projetos reais multi-arquivo. No modo automático eles SEMPRE usam o
  // modelo forte: o modelo fraco (haiku) emite formato AD_PATCH+json-like que o
  // parser não aplica e derruba a geração. Quem quer economizar escolhe
  // "Econômico" explicitamente; o automático prioriza entregar algo utilizável.
  if (opts.isApp) return "premium";
  if (opts.isRefinement && lightEdit) return "economy";
  if (complex) return "premium";
  return "economy";
}

export function modelFor(tier: Tier, provider: "openrouter" | "claude"): string {
  if (provider === "openrouter") return tier === "premium" ? PREMIUM_MODEL_OPENROUTER : ECON_MODEL_OPENROUTER;
  return tier === "premium" ? PREMIUM_MODEL_ANTHROPIC : ECON_MODEL_ANTHROPIC;
}

function uniqueModels(models: string[]): string[] {
  return [...new Set(models.filter(Boolean))];
}

/**
 * A escolha do tier continua sendo respeitada na PRIMEIRA tentativa. No
 * OpenRouter, falhas de saldo/disponibilidade seguem para um modelo barato e
 * depois para a rota free. Anthropic direta não troca de família/provedor.
 */
export function modelExecutionPlan(
  tier: Tier,
  provider: "openrouter" | "claude",
  opts?: { isApp?: boolean }
): string[] {
  const selected = modelFor(tier, provider);
  if (provider === "claude") return [selected];
  // Apps reais não rebaixam para modelos fracos/gratuitos. No tier premium,
  // porém, mantemos redundância entre modelos fortes de fornecedores distintos.
  // Isso preserva a qualidade e evita interromper a construção por um 5xx ou
  // pela retirada de um único modelo do catálogo.
  if (opts?.isApp) {
    return tier === "premium"
      ? uniqueModels([selected, ...PREMIUM_FALLBACK_MODELS_OPENROUTER])
      : [selected];
  }
  return uniqueModels([
    selected,
    BUDGET_MODEL_OPENROUTER,
    ...FREE_CODING_MODELS_OPENROUTER,
    FREE_MODEL_OPENROUTER,
  ]);
}

const PRICE: Record<string, { in: number; out: number }> = {
  "anthropic/claude-haiku-5.5": { in: 1, out: 5 },
  "anthropic/claude-3.5-haiku": { in: 0.8, out: 4 },
  "~anthropic/claude-sonnet-latest": { in: 2, out: 10 },
  "anthropic/claude-sonnet-5.5": { in: 2, out: 10 },
  "openai/gpt-6.1-sol": { in: 2, out: 10 },
  "google/gemini-4-argon": { in: 2, out: 10 },
  "xiaomi/mimo-v2.5": { in: 0.14, out: 0.28 },
  "openrouter/free": { in: 0, out: 0 },
  "claude-haiku-5-5": { in: 1, out: 5 },
  "claude-sonnet-5-5": { in: 2, out: 10 },
};

export function estimateCost(model: string, inTokens: number, outTokens: number): number {
  if (isFreeOpenRouterModel(model)) return 0;
  const p = PRICE[model] ?? { in: 3, out: 15 };
  return (inTokens / 1_000_000) * p.in + (outTokens / 1_000_000) * p.out;
}

export function preEstimate(tier: Tier, kind: "site" | "app"): { min: number; max: number } {
  if (tier === "premium") return kind === "app" ? { min: 0.04, max: 0.18 } : { min: 0.02, max: 0.09 };
  return kind === "app" ? { min: 0.01, max: 0.05 } : { min: 0.004, max: 0.02 };
}
