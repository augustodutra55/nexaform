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

/** Uma fase aprovável do plano, exibida no plan-card antes de gerar. */
export interface PlanPhase {
  id: string;
  title: string;
  detail: string;
}

/**
 * Deriva fases legíveis do plano para o cartão de aprovação (Fase 5). Combina
 * objetivo, capacidades exigidas, direção visual e critérios de aceite numa
 * sequência estável — o mesmo contrato consumido pela UI e padronizado na rota.
 */
export function buildPlanPhases(plan: GenerationPlan): PlanPhase[] {
  const phases: PlanPhase[] = [
    { id: "objective", title: "Objetivo e público", detail: `${plan.objective} — para ${plan.audience}.` },
  ];
  plan.requiredCapabilities.forEach((capability, index) => {
    phases.push({ id: `capability-${index}`, title: `Capacidade ${index + 1}`, detail: capability });
  });
  if (plan.visualProfile?.label) {
    phases.push({ id: "visual", title: "Direção visual", detail: `${plan.visualProfile.label} · ${plan.visualProfile.style}` });
  }
  if (plan.acceptanceCriteria?.length) {
    phases.push({ id: "acceptance", title: "Critérios de aceite", detail: plan.acceptanceCriteria.join("; ") });
  }
  return phases;
}

/** Envelope JSON padronizado do plano, devolvido pela rota e usado pela UI. */
export interface ProjectPlanView {
  id: string;
  prompt: string;
  status: ProjectPlanStatus;
  summary: string[];
  phases: PlanPhase[];
  approvedAt: string | null;
  executedAt: string | null;
  createdAt: string | null;
}

/** Normaliza uma linha de project_plans (com plan JSONB) para a UI. */
export function toProjectPlanView(row: {
  id: string;
  prompt: string;
  plan: GenerationPlan;
  status: ProjectPlanStatus | string;
  approved_at?: string | null;
  executed_at?: string | null;
  created_at?: string | null;
}): ProjectPlanView {
  return {
    id: row.id,
    prompt: row.prompt,
    status: (row.status as ProjectPlanStatus) ?? "draft",
    summary: renderPlanSummary(row.plan),
    phases: buildPlanPhases(row.plan),
    approvedAt: row.approved_at ?? null,
    executedAt: row.executed_at ?? null,
    createdAt: row.created_at ?? null,
  };
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
