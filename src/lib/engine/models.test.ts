import { describe, expect, it } from "vitest";
import {
  BUDGET_MODEL_OPENROUTER,
  ECON_MODEL_ANTHROPIC,
  ECON_MODEL_OPENROUTER,
  FREE_MODEL_OPENROUTER,
  PREMIUM_MODEL_ANTHROPIC,
  PREMIUM_MODEL_OPENROUTER,
  estimateCost,
  modelExecutionPlan,
} from "./models";

describe("modelExecutionPlan", () => {
  it("mantém Premium como primeira escolha e adiciona fallbacks de orçamento", () => {
    expect(modelExecutionPlan("premium", "openrouter")).toEqual([
      PREMIUM_MODEL_OPENROUTER,
      BUDGET_MODEL_OPENROUTER,
      FREE_MODEL_OPENROUTER,
    ]);
    expect(modelExecutionPlan("premium", "openrouter")).not.toContain(
      ECON_MODEL_OPENROUTER
    );
  });

  it("mantém Econômico como primeira escolha sem subir para Premium", () => {
    expect(modelExecutionPlan("economy", "openrouter")).toEqual([
      ECON_MODEL_OPENROUTER,
      BUDGET_MODEL_OPENROUTER,
      FREE_MODEL_OPENROUTER,
    ]);
    expect(modelExecutionPlan("economy", "openrouter")).not.toContain(
      PREMIUM_MODEL_OPENROUTER
    );
  });

  it("não aplica fallback de modelo na Anthropic direta", () => {
    expect(modelExecutionPlan("premium", "claude")).toEqual([
      PREMIUM_MODEL_ANTHROPIC,
    ]);
    expect(modelExecutionPlan("economy", "claude")).toEqual([
      ECON_MODEL_ANTHROPIC,
    ]);
  });

  it("estima custo baixo para o fallback e zero para a rota free", () => {
    expect(estimateCost(FREE_MODEL_OPENROUTER, 100_000, 100_000)).toBe(0);
    expect(estimateCost(BUDGET_MODEL_OPENROUTER, 1_000_000, 1_000_000)).toBeCloseTo(0.42, 5);
  });
});
