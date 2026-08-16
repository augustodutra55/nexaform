import { describe, expect, it } from "vitest";
import {
  BUDGET_MODEL_OPENROUTER,
  ECON_MODEL_ANTHROPIC,
  ECON_MODEL_OPENROUTER,
  FREE_CODING_MODELS_OPENROUTER,
  FREE_MODEL_OPENROUTER,
  PREMIUM_MODEL_ANTHROPIC,
  PREMIUM_MODEL_OPENROUTER,
  estimateCost,
  modelExecutionPlan,
  pickTier,
} from "./models";

describe("modelExecutionPlan", () => {
  it("mantém Premium como primeira escolha e adiciona fallbacks de orçamento", () => {
    expect(modelExecutionPlan("premium", "openrouter")).toEqual([
      PREMIUM_MODEL_OPENROUTER,
      BUDGET_MODEL_OPENROUTER,
      ...FREE_CODING_MODELS_OPENROUTER,
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
      ...FREE_CODING_MODELS_OPENROUTER,
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
    expect(estimateCost(FREE_CODING_MODELS_OPENROUTER[0], 100_000, 100_000)).toBe(0);
    expect(estimateCost(BUDGET_MODEL_OPENROUTER, 1_000_000, 1_000_000)).toBeCloseTo(0.42, 5);
  });

  it("tenta modelos gratuitos de coding concretos antes do roteador aleatório", () => {
    const plan = modelExecutionPlan("premium", "openrouter");
    expect(FREE_CODING_MODELS_OPENROUTER.length).toBeGreaterThanOrEqual(3);
    expect(plan.indexOf(FREE_CODING_MODELS_OPENROUTER[0])).toBeLessThan(
      plan.indexOf(FREE_MODEL_OPENROUTER)
    );
    expect(FREE_CODING_MODELS_OPENROUTER.every((model) => model.endsWith(":free"))).toBe(true);
  });

  it("APP não rebaixa para modelos fracos/grátis — usa só o modelo escolhido", () => {
    expect(modelExecutionPlan("premium", "openrouter", { isApp: true })).toEqual([
      PREMIUM_MODEL_OPENROUTER,
    ]);
    expect(modelExecutionPlan("economy", "openrouter", { isApp: true })).toEqual([
      ECON_MODEL_OPENROUTER,
    ]);
    const appPlan = modelExecutionPlan("premium", "openrouter", { isApp: true });
    expect(appPlan).not.toContain(BUDGET_MODEL_OPENROUTER);
    expect(appPlan).not.toContain(FREE_MODEL_OPENROUTER);
    FREE_CODING_MODELS_OPENROUTER.forEach((m) => expect(appPlan).not.toContain(m));
  });
});

describe("pickTier — app no automático sempre usa o modelo forte", () => {
  it("app no auto vira premium mesmo em refinamento leve (não cai para haiku)", () => {
    expect(pickTier("auto", { isApp: true, isRefinement: true, message: "mude a cor do botão" })).toBe("premium");
    expect(pickTier("auto", { isApp: true, isRefinement: false, message: "crie a esmalteria" })).toBe("premium");
  });

  it("respeita a escolha explícita do usuário (econômico continua econômico)", () => {
    expect(pickTier("economy", { isApp: true, isRefinement: true, message: "qualquer coisa" })).toBe("economy");
    expect(pickTier("premium", { isApp: false, isRefinement: true, message: "texto" })).toBe("premium");
  });

  it("sites/landing simples continuam podendo usar o econômico no auto", () => {
    expect(pickTier("auto", { isApp: false, isRefinement: true, message: "troque o título" })).toBe("economy");
  });
});
