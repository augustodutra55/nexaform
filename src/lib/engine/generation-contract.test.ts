import { describe, expect, it } from "vitest";
import { buildGenerationPlan } from "./generation-plan";
import { projectGenerationPlan } from "./generation-contract";

describe("projectGenerationPlan", () => {
  it("preserva o objetivo mestre durante correções curtas", () => {
    const master = buildGenerationPlan("Crie um programa odontológico completo com pacientes, agenda e prontuário");
    const refinement = buildGenerationPlan("está dando e-mail inválido resolva");

    expect(projectGenerationPlan(master, refinement, true)?.objective).toBe(master.objective);
  });

  it("usa o primeiro contrato real em um projeto novo", () => {
    const first = buildGenerationPlan("Crie uma clínica odontológica");
    expect(projectGenerationPlan(undefined, first, false)).toBe(first);
  });
});
