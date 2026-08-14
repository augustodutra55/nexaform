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

/** Modelo OpenRouter barato — bom para copy/estrutura/sites.
 *  (O slug antigo "anthropic/claude-3.5-haiku" foi descontinuado no OpenRouter e
 *   retornava 404 "No endpoints found", quebrando toda geração de site/landing.) */
export const ECON_MODEL_OPENROUTER = process.env.NEXT_PUBLIC_ECON_MODEL || "anthropic/claude-haiku-4.5";
/** Modelo OpenRouter forte — apps, lógica, refinos técnicos. */
export const PREMIUM_MODEL_OPENROUTER = process.env.NEXT_PUBLIC_PREMIUM_MODEL || "anthropic/claude-sonnet-4.5";
/**
 * Fallbacks de orçamento do OpenRouter. Mantemos o Claude escolhido como primeira
 * opção; estes modelos só entram se a chamada anterior falhar (incluindo HTTP 402).
 * Step 3.7 Flash preserva boa capacidade de coding com custo muito menor e o
 * roteador free garante uma última tentativa sem depender de saldo pago.
 */
export const BUDGET_MODEL_OPENROUTER = process.env.NEXT_PUBLIC_BUDGET_MODEL || "stepfun/step-3.7-flash";
export const FREE_MODEL_OPENROUTER = "openrouter/free";

/** Equivalentes para a API direta da Anthropic. */
export const ECON_MODEL_ANTHROPIC = "claude-3-5-haiku-latest";
export const PREMIUM_MODEL_ANTHROPIC = "claude-sonnet-4-5";

/**
 * Decide o tier a partir do modo escolhido e do contexto do pedido.
 * @param mode preferência do usuário (auto/economy/premium)
 * @param opts.isApp geração de app (código) — tende a premium
 * @param opts.isRefinement refinamento leve — tende a econômico
 * @param opts.message texto do pedido (heurística)
 */
export function pickTier(
  mode: CostMode,
  opts: { isApp?: boolean; isRefinement?: boolean; message?: string }
): Tier {
  if (mode === "economy") return "economy";
  if (mode === "premium") return "premium";

  // auto
  const m = (opts.message || "").toLowerCase();
  const complex =
    /\b(l[óo]gica|interativ|jogo|jogar|game|algoritmo|c[áa]lcul|state|drag|arrast|anima[çc][ãa]o|valida|integra|api|gr[áa]fico complexo|multi.?etapa|fluxo)\b/.test(
      m
    );
  // Refinamentos leves de texto/tema quase nunca precisam do modelo forte.
  const lightEdit = /\b(troque|mude|ajuste|cor|texto|t[íi]tulo|fonte|espa[çc]|tom|remova|adicione uma se[çc][ãa]o)\b/.test(m);

  if (opts.isApp) return complex || !opts.isRefinement ? "premium" : "economy";
  if (opts.isRefinement && lightEdit) return "economy";
  if (complex) return "premium";
  return "economy"; // sites/landing/copy por padrão
}

export function modelFor(tier: Tier, provider: "openrouter" | "claude"): string {
  if (provider === "openrouter") return tier === "premium" ? PREMIUM_MODEL_OPENROUTER : ECON_MODEL_OPENROUTER;
  return tier === "premium" ? PREMIUM_MODEL_ANTHROPIC : ECON_MODEL_ANTHROPIC;
}

function uniqueModels(models: string[]): string[] {
  return [...new Set(models.filter(Boolean))];
}

/**
 * Plano de execução previsível para uma geração.
 *
 * A escolha de tier continua sendo respeitada na PRIMEIRA tentativa. No
 * OpenRouter, falhas de disponibilidade/saldo podem cair para uma rota de
 * orçamento menor e, por último, para inferência gratuita. Isso evita que um
 * teto de max_tokens transforme saldo baixo em indisponibilidade total do AD
 * Studio. Na Anthropic direta não fazemos troca de família/provedor.
 */
export function modelExecutionPlan(
  tier: Tier,
  provider: "openrouter" | "claude"
): string[] {
  const selected = modelFor(tier, provider);
  if (provider === "claude") return [selected];
  return uniqueModels([
    selected,
    BUDGET_MODEL_OPENROUTER,
    FREE_MODEL_OPENROUTER,
  ]);
}

/** Preços de referência (USD por 1M tokens) para estimar custo quando o
 *  provedor não devolve o custo real. Aproximado; o custo real prevalece. */
const PRICE: Record<string, { in: number; out: number }> = {
  "anthropic/claude-haiku-4.5": { in: 1, out: 5 },
  "anthropic/claude-3.5-haiku": { in: 0.8, out: 4 },
  "anthropic/claude-sonnet-4.5": { in: 3, out: 15 },
  "stepfun/step-3.7-flash": { in: 0.2, out: 1.15 },
  "openrouter/free": { in: 0, out: 0 },
  "claude-3-5-haiku-latest": { in: 0.8, out: 4 },
  "claude-sonnet-4-5": { in: 3, out: 15 },
};

export function estimateCost(model: string, inTokens: number, outTokens: number): number {
  const p = PRICE[model] ?? { in: 3, out: 15 };
  return (inTokens / 1_000_000) * p.in + (outTokens / 1_000_000) * p.out;
}

/** Estimativa grosseira ANTES da geração (faixa), só para orientar o usuário. */
export function preEstimate(tier: Tier, kind: "site" | "app"): { min: number; max: number } {
  // valores empíricos por tipo/tier
  if (tier === "premium") return kind === "app" ? { min: 0.04, max: 0.18 } : { min: 0.02, max: 0.09 };
  return kind === "app" ? { min: 0.01, max: 0.05 } : { min: 0.004, max: 0.02 };
}
