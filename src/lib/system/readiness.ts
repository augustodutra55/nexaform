export type ReadinessStatus = "ready" | "warning" | "blocked";

export interface ReadinessCheck {
  id: string;
  label: string;
  detail: string;
  status: ReadinessStatus;
  action?: string;
}

export interface ReadinessReport {
  status: ReadinessStatus;
  ready: number;
  total: number;
  checks: ReadinessCheck[];
  generatedAt: string;
}

const severity: Record<ReadinessStatus, number> = {
  ready: 0,
  warning: 1,
  blocked: 2,
};

export function summarizeReadiness(
  checks: ReadinessCheck[],
  generatedAt = new Date().toISOString()
): ReadinessReport {
  const status = checks.reduce<ReadinessStatus>(
    (current, check) => severity[check.status] > severity[current] ? check.status : current,
    "ready"
  );
  return {
    status,
    ready: checks.filter((check) => check.status === "ready").length,
    total: checks.length,
    checks,
    generatedAt,
  };
}

export function probeCheck(input: {
  id: string;
  label: string;
  ok: boolean;
  readyDetail: string;
  missingDetail: string;
  action?: string;
  optional?: boolean;
}): ReadinessCheck {
  return {
    id: input.id,
    label: input.label,
    detail: input.ok ? input.readyDetail : input.missingDetail,
    status: input.ok ? "ready" : input.optional ? "warning" : "blocked",
    action: input.ok ? undefined : input.action,
  };
}
