export type BackgroundJobStatus =
  | "active"
  | "queued"
  | "running"
  | "retry"
  | "completed"
  | "failed"
  | "cancelled";

export const BACKGROUND_GENERATION_VERSION = 1;
export const BACKGROUND_MAX_ATTEMPTS = 3;

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
  result?: unknown;
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
      return `Gerando · tentativa ${Math.max(1, attempts)}/${BACKGROUND_MAX_ATTEMPTS}`;
    case "retry":
      return `Nova tentativa${attempts > 0 ? ` ${attempts + 1}/${BACKGROUND_MAX_ATTEMPTS}` : ""}`;
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
}): BackgroundJobStatus {
  if (isTerminalJobStatus(input.status)) return input.status;
  if (input.succeeded) return "completed";
  return input.attempts >= (input.maxAttempts ?? 3) ? "failed" : "retry";
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
  return payload.version === BACKGROUND_GENERATION_VERSION
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
    && typeof payload.queuedAt === "string";
}
