import { describe, expect, it } from "vitest";
import {
  BACKGROUND_GENERATION_VERSION,
  isBackgroundGenerationPayload,
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
      attempts: 3,
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

  it("aplica espera exponencial limitada a 15 minutos", () => {
    expect(retryDelaySeconds(1)).toBe(30);
    expect(retryDelaySeconds(2)).toBe(60);
    expect(retryDelaySeconds(10)).toBe(900);
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
  });
});
