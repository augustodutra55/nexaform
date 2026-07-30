export type BackgroundJobStatus =
  | "active"
  | "queued"
  | "running"
  | "retry"
  | "completed"
  | "failed"
  | "cancelled";

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
  return Math.min(900, 30 * Math.pow(2, safeAttempts - 1));
}
