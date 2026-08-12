import type { GenerationPlan } from "./app-types";

export type WorkspaceMode = "plan" | "agent";
export type ProjectPlanStatus = "draft" | "approved" | "executing" | "completed" | "cancelled";

export interface ProjectPlanSnapshot {
  id: string;
  projectId: string;
  prompt: string;
  plan: GenerationPlan;
  status: ProjectPlanStatus;
  createdAt: string;
  approvedAt?: string;
  executedAt?: string;
}

export function normalizeWorkspaceMode(value: unknown): WorkspaceMode {
  return value === "plan" ? "plan" : "agent";
}

export function canExecutePlan(status: ProjectPlanStatus): boolean {
  return status === "approved";
}

export function nextPlanStatus(
  current: ProjectPlanStatus,
  action: "approve" | "execute" | "complete" | "cancel"
): ProjectPlanStatus {
  if (action === "cancel") return "cancelled";
  if (action === "approve" && current === "draft") return "approved";
  if (action === "execute" && current === "approved") return "executing";
  if (action === "complete" && current === "executing") return "completed";
  throw new Error(`Transição inválida de plano: ${current} -> ${action}`);
}

export function renderPlanSummary(plan: GenerationPlan): string[] {
  return [
    `Objetivo: ${plan.objective}`,
    `Público: ${plan.audience}`,
    `Capacidades: ${plan.requiredCapabilities.join("; ")}`,
    `Visual: ${plan.visualProfile.label}`,
    `Aceite: ${plan.acceptanceCriteria.join("; ")}`,
  ];
}

export function buildAgentExecutionContext(snapshot: Pick<ProjectPlanSnapshot, "id" | "prompt" | "plan">): string {
  return [
    "=== PLANO APROVADO PELO USUÁRIO ===",
    `Plano: ${snapshot.id}`,
    `Pedido original: ${snapshot.prompt}`,
    ...renderPlanSummary(snapshot.plan),
    "Execute exatamente este plano. Não altere escopo sem necessidade técnica e valide os critérios de aceite antes de concluir.",
  ].join("\n");
}
