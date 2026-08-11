import { describe, expect, it } from "vitest";
import {
  BACKGROUND_GENERATION_VERSION,
  BACKGROUND_MAX_ATTEMPTS,
  backgroundJobLabel,
  isBackgroundGenerationPayload,
  isBackgroundJobSnapshot,
  isRetryableBackgroundFailure,
  isTerminalJobStatus,
  nextBackgroundJobStatus,
  retryDelaySeconds,
} from "./background-jobs";

describe("background generation jobs", () => {
  it("conclui somente depois de uma execução bem-sucedida", () => {
    expect(nextBackgroundJobStatus({
      status: "running",
      succeeded: true,
      attempts: 1,
    })).toBe("completed");
  });

  it("repete falhas transitórias e encerra no limite", () => {
    expect(nextBackgroundJobStatus({
      status: "running",
      succeeded: false,
      attempts: 1,
    })).toBe("retry");
    expect(nextBackgroundJobStatus({
      status: "running",
      succeeded: false,
      attempts: BACKGROUND_MAX_ATTEMPTS,
    })).toBe("failed");
  });

  it("não repete falhas permanentes e permite uma repetição transitória", () => {
    expect(isRetryableBackgroundFailure("OpenRouter: HTTP 402 — sem saldo.")).toBe(false);
    expect(isRetryableBackgroundFailure("O modelo não respondeu dentro do tempo limite.")).toBe(true);
    expect(nextBackgroundJobStatus({
      status: "running",
      succeeded: false,
      attempts: 1,
      retryable: false,
    })).toBe("failed");
  });

  it("não ressuscita estados terminais", () => {
    expect(isTerminalJobStatus("cancelled")).toBe(true);
    expect(nextBackgroundJobStatus({
      status: "cancelled",
      succeeded: true,
      attempts: 1,
    })).toBe("cancelled");
  });

  it("aplica espera curta e limitada a 2 minutos", () => {
    expect(retryDelaySeconds(1)).toBe(10);
    expect(retryDelaySeconds(2)).toBe(20);
    expect(retryDelaySeconds(10)).toBe(120);
  });

  it("aceita somente payload da etapa e do projeto corretos", () => {
    const payload = {
      version: BACKGROUND_GENERATION_VERSION,
      projectId: "project-1",
      threadId: "thread-1",
      userId: "user-1",
      stagedJob: {
        version: 1,
        projectId: "project-1",
        threadId: "thread-1",
        originalPrompt: "Crie um app",
        masterPrompt: "Crie um app completo",
        kind: "initial" as const,
        nextStage: 2,
        startedAt: new Date().toISOString(),
      },
      stageIndex: 2,
      requestId: "request-1",
      reservationId: "reservation-1",
      name: "Meu app",
      costMode: "auto" as const,
      queuedAt: new Date().toISOString(),
    };
    expect(isBackgroundGenerationPayload(payload)).toBe(true);
    expect(isBackgroundGenerationPayload({ ...payload, stageIndex: 1 })).toBe(false);
    expect(isBackgroundGenerationPayload({
      ...payload,
      stagedJob: { ...payload.stagedJob, projectId: "outro" },
    })).toBe(false);
    expect(isBackgroundJobSnapshot({
      id: "job-1",
      status: "completed",
      payload,
      attempts: 1,
      next_attempt_at: null,
      last_error: null,
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })).toBe(true);
  });

  it("explica o estado da fila em linguagem de interface", () => {
    expect(backgroundJobLabel("queued")).toBe("Na fila · aguardando execução");
    expect(backgroundJobLabel("running", 1)).toBe("Gerando etapa · tentativa 1/2");
    expect(backgroundJobLabel("retry", 1)).toContain("2/2");
    expect(backgroundJobLabel("completed")).toBe("Aplicando resultado");
  });
});
