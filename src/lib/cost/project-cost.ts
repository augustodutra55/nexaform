// Custo real do projeto — some o que já foi gasto em gerações para que o
// criador possa precificar o trabalho e comparar com o custo fixo de outras
// ferramentas. Lê a coluna cost_usd (numeric) que já existe em `generations`.
// Funções puras: fáceis de testar e sem dependência de rede.

export interface GenerationCostRow {
  cost_usd?: number | string | null;
  model?: string | null;
  provider?: string | null;
  status?: string | null;
  created_at?: string | null;
}

export interface ModelCostBreakdown {
  model: string;
  generations: number;
  totalUsd: number;
}

export interface DailyCostBreakdown {
  day: string; // YYYY-MM-DD
  generations: number;
  totalUsd: number;
}

export interface ProjectCostSummary {
  totalUsd: number;
  billableGenerations: number;
  failedGenerations: number;
  averageUsd: number;
  maxUsd: number;
  lastGenerationAt: string | null;
  byModel: ModelCostBreakdown[];
  byDay: DailyCostBreakdown[];
}

function toUsd(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function dayOf(iso: string | null | undefined): string | null {
  if (!iso || typeof iso !== "string") return null;
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/**
 * Resume o custo de um projeto a partir das linhas de `generations`.
 * Considera apenas o custo real cobrado (cost_usd > 0); gerações que falharam
 * sem custo não inflam a média. Ordena os recortes do maior para o menor.
 */
export function aggregateProjectCost(rows: GenerationCostRow[]): ProjectCostSummary {
  const modelMap = new Map<string, ModelCostBreakdown>();
  const dayMap = new Map<string, DailyCostBreakdown>();

  let totalUsd = 0;
  let billableGenerations = 0;
  let failedGenerations = 0;
  let maxUsd = 0;
  let lastGenerationAt: string | null = null;

  for (const row of rows ?? []) {
    if (row?.status === "failed") failedGenerations += 1;

    const created = typeof row?.created_at === "string" ? row.created_at : null;
    if (created && (!lastGenerationAt || created > lastGenerationAt)) {
      lastGenerationAt = created;
    }

    const usd = toUsd(row?.cost_usd);
    if (usd <= 0) continue;

    totalUsd += usd;
    billableGenerations += 1;
    if (usd > maxUsd) maxUsd = usd;

    const model = (row?.model && row.model.trim()) || row?.provider || "desconhecido";
    const m = modelMap.get(model) ?? { model, generations: 0, totalUsd: 0 };
    m.generations += 1;
    m.totalUsd += usd;
    modelMap.set(model, m);

    const day = dayOf(created);
    if (day) {
      const d = dayMap.get(day) ?? { day, generations: 0, totalUsd: 0 };
      d.generations += 1;
      d.totalUsd += usd;
      dayMap.set(day, d);
    }
  }

  const round = (n: number) => Math.round(n * 1e6) / 1e6;

  return {
    totalUsd: round(totalUsd),
    billableGenerations,
    failedGenerations,
    averageUsd: billableGenerations ? round(totalUsd / billableGenerations) : 0,
    maxUsd: round(maxUsd),
    lastGenerationAt,
    byModel: Array.from(modelMap.values())
      .map((m) => ({ ...m, totalUsd: round(m.totalUsd) }))
      .sort((a, b) => b.totalUsd - a.totalUsd),
    byDay: Array.from(dayMap.values())
      .map((d) => ({ ...d, totalUsd: round(d.totalUsd) }))
      .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0)),
  };
}

/** Formata um valor em dólar para exibição (4 casas para custos pequenos). */
export function formatUsd(value: number): string {
  const n = Number.isFinite(value) && value > 0 ? value : 0;
  const digits = n > 0 && n < 1 ? 4 : 2;
  return `US$ ${n.toFixed(digits)}`;
}

/**
 * Sugere um preço de venda a partir do custo total, aplicando uma margem.
 * É só um ponto de partida para precificação — o criador decide o valor final.
 * Piso mínimo evita sugerir um preço irrisório para projetos de custo baixo.
 */
export function suggestSalePrice(
  totalUsd: number,
  options?: { marginMultiplier?: number; floorUsd?: number }
): number {
  const margin = options?.marginMultiplier ?? 20;
  const floor = options?.floorUsd ?? 0;
  const base = Number.isFinite(totalUsd) && totalUsd > 0 ? totalUsd : 0;
  return Math.max(floor, Math.round(base * margin * 100) / 100);
}
