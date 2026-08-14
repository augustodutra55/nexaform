import { isAppCode, type AppCode, type AppGenerationResult } from "./app-types";

export type BackgroundJobStatus =
  | "active"
  | "queued"
  | "running"
  | "retry"
  | "completed"
  | "failed"
  | "cancelled";

export const BACKGROUND_GENERATION_VERSION = 2;
const SUPPORTED_BACKGROUND_GENERATION_VERSIONS = [1, BACKGROUND_GENERATION_VERSION];
/**
 * Uma etapa pode consumir uma chamada paga longa. Permitimos uma única segunda
 * execução, somente para falha estrutural/aplicação, com escopo reduzido.
 * Erros de saldo, autenticação e timeout não são repetidos automaticamente.
 */
export const BACKGROUND_MAX_ATTEMPTS = 2;

export interface BackgroundGenerationPayload {
  version: number;
  projectId: string;
  threadId: string;
  userId: string;
  stagedJob: {
    version: number;
    projectId: string;
    threadId: string;
    originalPrompt: string;
    masterPrompt: string;
    kind?: "initial" | "refinement";
    nextStage: number;
    startedAt: string;
  };
  stageIndex: number;
  requestId: string;
  reservationId: string | null;
  name: string;
  costMode: "auto" | "economy" | "premium";
  queuedAt: string;
  /** Snapshot aprovado pelo motor na última etapa. Ele viaja dentro da fila para
   * que a etapa seguinte não dependa do navegador nem de um salvamento do preview. */
  currentApp?: AppCode;
  accumulatedCost?: number;
  accumulatedDurationMs?: number;
  result?: unknown;
}

export interface BackgroundStageTransition {
  completed: boolean;
  payload: BackgroundGenerationPayload;
  totalCost: number;
  totalDurationMs: number;
}

export interface BackgroundJobSnapshot {
  id: string;
  status: BackgroundJobStatus;
  payload: BackgroundGenerationPayload;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  updated_at: string;
  completed_at: string | null;
}

export function backgroundJobLabel(
  status: BackgroundJobStatus,
  attempts = 0
): string {
  switch (status) {
    case "queued":
      return "Na fila · aguardando execução";
    case "running":
      return "Gerando etapa";
    case "retry":
      return "Etapa aguardando continuação";
    case "completed":
      return "Aplicando resultado";
    case "failed":
      return "Etapa pausada";
    case "cancelled":
      return "Cancelada";
    default:
      return "Preparando";
  }
}

export function isBackgroundJobSnapshot(value: unknown): value is BackgroundJobSnapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<BackgroundJobSnapshot>;
  return typeof row.id === "string"
    && typeof row.status === "string"
    && [
      "active",
      "queued",
      "running",
      "retry",
      "completed",
      "failed",
      "cancelled",
    ].includes(row.status)
    && isBackgroundGenerationPayload(row.payload)
    && Number.isInteger(row.attempts)
    && typeof row.updated_at === "string";
}

const TERMINAL = new Set<BackgroundJobStatus>([
  "completed",
  "failed",
  "cancelled",
]);

export function isTerminalJobStatus(status: BackgroundJobStatus): boolean {
  return TERMINAL.has(status);
}

export function nextBackgroundJobStatus(input: {
  status: BackgroundJobStatus;
  succeeded: boolean;
  attempts: number;
  maxAttempts?: number;
  retryable?: boolean;
}): BackgroundJobStatus {
  if (isTerminalJobStatus(input.status)) return input.status;
  if (input.succeeded) return "completed";
  if (input.retryable === false) return "failed";
  return input.attempts >= (input.maxAttempts ?? BACKGROUND_MAX_ATTEMPTS) ? "failed" : "retry";
}

/**
 * Só falhas em que o provedor respondeu com código aproveitável recebem uma
 * segunda tentativa curta. Isso evita cobrar novamente por indisponibilidade.
 */
export function isRetryableBackgroundFailure(message: string): boolean {
  return /quality gate|estruturalmente inv[aá]lido|n[aã]o p[oô]de ser aplicada|continuou inv[aá]lida/i.test(message);
}

export function retryDelaySeconds(attempts: number): number {
  const safeAttempts = Math.max(1, Math.min(10, Math.floor(attempts)));
  return Math.min(120, 10 * Math.pow(2, safeAttempts - 1));
}

export function isBackgroundGenerationPayload(
  value: unknown
): value is BackgroundGenerationPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<BackgroundGenerationPayload>;
  const job = payload.stagedJob;
  return typeof payload.version === "number"
    && SUPPORTED_BACKGROUND_GENERATION_VERSIONS.includes(payload.version)
    && typeof payload.projectId === "string"
    && typeof payload.threadId === "string"
    && typeof payload.userId === "string"
    && !!job
    && typeof job === "object"
    && job.projectId === payload.projectId
    && job.threadId === payload.threadId
    && typeof job.originalPrompt === "string"
    && typeof job.masterPrompt === "string"
    && (job.kind === undefined || job.kind === "initial" || job.kind === "refinement")
    && Number.isInteger(job.nextStage)
    && Number.isInteger(payload.stageIndex)
    && payload.stageIndex === job.nextStage
    && typeof payload.requestId === "string"
    && (payload.reservationId === null || typeof payload.reservationId === "string")
    && typeof payload.name === "string"
    && (payload.costMode === "auto" || payload.costMode === "economy" || payload.costMode === "premium")
    && typeof payload.queuedAt === "string"
    && (payload.currentApp === undefined || isAppCode(payload.currentApp))
    && isOptionalNonNegativeNumber(payload.accumulatedCost)
    && isOptionalNonNegativeNumber(payload.accumulatedDurationMs);
}

function isOptionalNonNegativeNumber(value: unknown): boolean {
  return value === undefined
    || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

/**
 * Incorpora o resultado de uma etapa à própria fila. Se ainda houver trabalho,
 * devolve um payload pronto para ser novamente enfileirado; somente a última
 * etapa expõe `result` ao navegador.
 */
export function advanceBackgroundGeneration(
  payload: BackgroundGenerationPayload,
  result: AppGenerationResult,
  totalStages: number,
  durationMs: number,
  queuedAt: string
): BackgroundStageTransition {
  const totalCost = Math.max(0, payload.accumulatedCost ?? 0)
    + Math.max(0, result.cost ?? 0);
  const totalDurationMs = Math.max(0, payload.accumulatedDurationMs ?? 0)
    + Math.max(0, durationMs);
  const nextStage = payload.stageIndex + 1;
  const { result: _previousResult, ...basePayload } = payload;
  void _previousResult;

  if (nextStage < totalStages) {
    return {
      completed: false,
      totalCost,
      totalDurationMs,
      payload: {
        ...basePayload,
        version: BACKGROUND_GENERATION_VERSION,
        stagedJob: { ...payload.stagedJob, nextStage },
        stageIndex: nextStage,
        queuedAt,
        currentApp: result.app,
        accumulatedCost: totalCost,
        accumulatedDurationMs: totalDurationMs,
      },
    };
  }

  const finalResult: AppGenerationResult = { ...result, cost: totalCost };
  return {
    completed: true,
    totalCost,
    totalDurationMs,
    payload: {
      ...basePayload,
      version: BACKGROUND_GENERATION_VERSION,
      currentApp: result.app,
      accumulatedCost: totalCost,
      accumulatedDurationMs: totalDurationMs,
      result: finalResult,
    },
  };
}
