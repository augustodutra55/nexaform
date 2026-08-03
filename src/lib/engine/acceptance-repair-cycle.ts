import type { AppCode } from "./app-types";
import { isMultiFile } from "./app-types";
import type { ProjectQualityReport } from "./app-types";
import type { RuntimeAuditReport } from "@/lib/preview/runtime-audit";

export interface RepairCandidateEvaluation {
  approved: boolean;
  reason: "approved" | "unchanged" | "structural" | "runtime" | "audit_missing";
  candidateFingerprint: string;
  resolvedIssueCodes: string[];
  introducedIssueCodes: string[];
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

/** Assinatura estável do código, independente da ordem dos arquivos. */
export function appCodeFingerprint(app: AppCode | null | undefined): string {
  if (!app) return "none";
  if (!isMultiFile(app)) return `single:${hash(app.code || "")}`;
  const source = app.files
    .map((file) => `${file.path}\n${file.content}`)
    .sort()
    .join("\n---AD-FILE---\n");
  return `multi:${hash(`${app.entry}\n${source}`)}`;
}

export function blockingIssueCodes(
  runtime?: RuntimeAuditReport,
  structural?: ProjectQualityReport
): string[] {
  const codes = (runtime?.issues || [])
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.code)
    .concat((structural?.errors || []).map((issue) => issue.code));
  return codes.filter((code, index, values) => values.indexOf(code) === index).sort();
}

/**
 * Aprova uma correção somente quando ela alterou o código, passou pela validação
 * estrutural e recebeu uma auditoria nova sem bloqueios.
 */
export function evaluateRepairCandidate(input: {
  baselineAppFingerprint: string;
  baselineIssueCodes: string[];
  candidate: AppCode;
  structural?: ProjectQualityReport;
  runtime?: RuntimeAuditReport;
  repairStartedAt: string;
}): RepairCandidateEvaluation {
  const candidateFingerprint = appCodeFingerprint(input.candidate);
  const currentCodes = blockingIssueCodes(input.runtime, input.structural);
  const baseline = input.baselineIssueCodes.slice().sort();
  const resolvedIssueCodes = baseline.filter((code) => currentCodes.indexOf(code) < 0);
  const introducedIssueCodes = currentCodes.filter((code) => baseline.indexOf(code) < 0);

  if (candidateFingerprint === input.baselineAppFingerprint) {
    return { approved: false, reason: "unchanged", candidateFingerprint, resolvedIssueCodes, introducedIssueCodes };
  }
  if (input.structural && !input.structural.valid) {
    return { approved: false, reason: "structural", candidateFingerprint, resolvedIssueCodes, introducedIssueCodes };
  }
  if (!input.runtime || input.runtime.checkedAt < Date.parse(input.repairStartedAt)) {
    return { approved: false, reason: "audit_missing", candidateFingerprint, resolvedIssueCodes, introducedIssueCodes };
  }
  if (currentCodes.length) {
    return { approved: false, reason: "runtime", candidateFingerprint, resolvedIssueCodes, introducedIssueCodes };
  }
  return { approved: true, reason: "approved", candidateFingerprint, resolvedIssueCodes, introducedIssueCodes };
}
