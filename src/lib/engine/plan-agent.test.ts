import { describe, expect, it } from "vitest";
import { buildGenerationPlan } from "./generation-plan";
import {
  buildAgentExecutionContext,
  canExecutePlan,
  nextPlanStatus,
  normalizeWorkspaceMode,
  renderPlanSummary,
} from "./plan-agent";

describe("plan-agent", () => {
  it("mantém Agent como padrão e reconhece Plan", () => {
    expect(normalizeWorkspaceMode("plan")).toBe("plan");
    expect(normalizeWorkspaceMode("agent")).toBe("agent");
    expect(normalizeWorkspaceMode("qualquer")).toBe("agent");
  });

  it("exige aprovação antes da execução", () => {
    expect(canExecutePlan("draft")).toBe(false);
    expect(canExecutePlan("approved")).toBe(true);
    expect(nextPlanStatus("draft", "approve")).toBe("approved");
    expect(nextPlanStatus("approved", "execute")).toBe("executing");
    expect(nextPlanStatus("executing", "complete")).toBe("completed");
  });

  it("rejeita transições que pulam etapas", () => {
    expect(() => nextPlanStatus("draft", "execute")).toThrow(/Transição inválida/);
    expect(() => nextPlanStatus("approved", "complete")).toThrow(/Transição inválida/);
  });

  it("gera um resumo legível e contexto de execução", () => {
    const plan = buildGenerationPlan("Crie um app CRM profissional com login e clientes");
    const summary = renderPlanSummary(plan);
    expect(summary.join(" ")).toContain("CRM");
    const context = buildAgentExecutionContext({ id: "plano-1", prompt: "CRM", plan });
    expect(context).toContain("PLANO APROVADO");
    expect(context).toContain("plano-1");
  });
});
