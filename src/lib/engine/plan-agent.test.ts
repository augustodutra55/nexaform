import { describe, expect, it } from "vitest";
import { buildGenerationPlan } from "./generation-plan";
import {
  buildAgentExecutionContext,
  buildPlanPhases,
  canExecutePlan,
  nextPlanStatus,
  normalizeWorkspaceMode,
  renderPlanSummary,
  toProjectPlanView,
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

describe("plano auto — fases e view padronizada (Fase 5)", () => {
  it("deriva fases estáveis a partir do plano", () => {
    const plan = buildGenerationPlan("Crie um app de agendamento para esmalteria com login e painel admin");
    const phases = buildPlanPhases(plan);
    expect(phases.length).toBeGreaterThan(1);
    expect(phases[0].id).toBe("objective");
    expect(phases[0].detail).toContain(plan.objective);
    expect(phases.some((phase) => phase.id === "visual")).toBe(true);
    expect(phases.some((phase) => phase.id === "acceptance")).toBe(true);
  });

  it("normaliza uma linha de project_plans para a view da UI", () => {
    const plan = buildGenerationPlan("Landing premium para consultoria com FAQ");
    const view = toProjectPlanView({
      id: "11111111-1111-1111-1111-111111111111",
      prompt: "Landing premium para consultoria com FAQ",
      plan,
      status: "draft",
      approved_at: null,
      executed_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
    });
    expect(view.status).toBe("draft");
    expect(view.summary).toEqual(renderPlanSummary(plan));
    expect(view.phases).toEqual(buildPlanPhases(plan));
    expect(view.approvedAt).toBeNull();
    expect(view.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
