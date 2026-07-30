import { describe, expect, it } from "vitest";
import {
  ECON_MODEL_ANTHROPIC,
  ECON_MODEL_OPENROUTER,
  PREMIUM_MODEL_ANTHROPIC,
  PREMIUM_MODEL_OPENROUTER,
  modelExecutionPlan,
} from "./models";

describe("modelExecutionPlan", () => {
  it("mantém Premium no OpenRouter sem cair para Haiku", () => {
    expect(modelExecutionPlan("premium", "openrouter")).toEqual([
      PREMIUM_MODEL_OPENROUTER,
    ]);
    expect(modelExecutionPlan("premium", "openrouter")).not.toContain(
      ECON_MODEL_OPENROUTER
    );
  });

  it("mantém Econômico no OpenRouter sem subir o custo silenciosamente", () => {
    expect(modelExecutionPlan("economy", "openrouter")).toEqual([
      ECON_MODEL_OPENROUTER,
    ]);
    expect(modelExecutionPlan("economy", "openrouter")).not.toContain(
      PREMIUM_MODEL_OPENROUTER
    );
  });

  it("preserva a mesma política na Anthropic direta", () => {
    expect(modelExecutionPlan("premium", "claude")).toEqual([
      PREMIUM_MODEL_ANTHROPIC,
    ]);
    expect(modelExecutionPlan("economy", "claude")).toEqual([
      ECON_MODEL_ANTHROPIC,
    ]);
  });
});
