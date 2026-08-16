import { describe, expect, it } from "vitest";
import {
  aggregateProjectCost,
  formatUsd,
  suggestSalePrice,
  type GenerationCostRow,
} from "./project-cost";

describe("aggregateProjectCost", () => {
  const rows: GenerationCostRow[] = [
    { cost_usd: 0.12, model: "claude-sonnet", status: "completed", created_at: "2026-08-10T10:00:00Z" },
    { cost_usd: "0.08", model: "claude-sonnet", status: "completed", created_at: "2026-08-10T14:00:00Z" },
    { cost_usd: 0.3, model: "gpt-4o", status: "completed", created_at: "2026-08-11T09:00:00Z" },
    { cost_usd: 0, model: "free", status: "failed", created_at: "2026-08-11T09:30:00Z" },
  ];

  it("soma somente o custo cobrado e conta as gerações faturáveis", () => {
    const s = aggregateProjectCost(rows);
    expect(s.totalUsd).toBeCloseTo(0.5, 6);
    expect(s.billableGenerations).toBe(3);
    expect(s.failedGenerations).toBe(1);
  });

  it("calcula média e maior custo sem contar gerações sem custo", () => {
    const s = aggregateProjectCost(rows);
    expect(s.averageUsd).toBeCloseTo(0.5 / 3, 6);
    expect(s.maxUsd).toBeCloseTo(0.3, 6);
  });

  it("agrupa por modelo e ordena do maior gasto para o menor", () => {
    const s = aggregateProjectCost(rows);
    expect(s.byModel[0]).toMatchObject({ model: "gpt-4o", generations: 1 });
    expect(s.byModel[1]).toMatchObject({ model: "claude-sonnet", generations: 2 });
    expect(s.byModel[1].totalUsd).toBeCloseTo(0.2, 6);
  });

  it("agrupa por dia em ordem decrescente de data", () => {
    const s = aggregateProjectCost(rows);
    expect(s.byDay.map((d) => d.day)).toEqual(["2026-08-11", "2026-08-10"]);
    expect(s.byDay[1].totalUsd).toBeCloseTo(0.2, 6);
  });

  it("guarda a data da última geração (inclusive falhas)", () => {
    const s = aggregateProjectCost(rows);
    expect(s.lastGenerationAt).toBe("2026-08-11T09:30:00Z");
  });

  it("lida com lista vazia sem quebrar", () => {
    const s = aggregateProjectCost([]);
    expect(s).toMatchObject({ totalUsd: 0, billableGenerations: 0, averageUsd: 0, maxUsd: 0 });
    expect(s.byModel).toEqual([]);
    expect(s.byDay).toEqual([]);
    expect(s.lastGenerationAt).toBeNull();
  });

  it("ignora custos inválidos ou negativos", () => {
    const s = aggregateProjectCost([
      { cost_usd: -1, status: "completed", created_at: "2026-08-10T10:00:00Z" },
      { cost_usd: "abc" as unknown as string, status: "completed", created_at: "2026-08-10T10:00:00Z" },
    ]);
    expect(s.totalUsd).toBe(0);
    expect(s.billableGenerations).toBe(0);
  });
});

describe("formatUsd", () => {
  it("usa 4 casas para valores menores que 1 dólar", () => {
    expect(formatUsd(0.0834)).toBe("US$ 0.0834");
  });
  it("usa 2 casas para valores maiores", () => {
    expect(formatUsd(12.5)).toBe("US$ 12.50");
  });
  it("trata valores inválidos como zero", () => {
    expect(formatUsd(NaN)).toBe("US$ 0.00");
  });
});

describe("suggestSalePrice", () => {
  it("aplica a margem padrão sobre o custo", () => {
    expect(suggestSalePrice(0.5)).toBe(10);
  });
  it("respeita um piso mínimo", () => {
    expect(suggestSalePrice(0.01, { floorUsd: 50 })).toBe(50);
  });
  it("aceita margem customizada", () => {
    expect(suggestSalePrice(1, { marginMultiplier: 100 })).toBe(100);
  });
});
