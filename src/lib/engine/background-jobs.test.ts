import { describe, expect, it } from "vitest";
import {
  BACKGROUND_GENERATION_VERSION,
  BACKGROUND_MAX_ATTEMPTS,
  advanceBackgroundGeneration,
  backgroundJobLabel,
  isBackgroundGenerationPayload,
  isBackgroundJobSnapshot,
  isRetryableBackgroundFailure,
  isTerminalJobStatus,
  nextBackgroundJobStatus,
  retryDelaySeconds,
  salvageFinalStageResult,
} from "./background-jobs";

describe("background generation jobs", () => {
  it("conclui somente depois de uma execução bem-sucedida", () => {
    expect(nextBackgroundJobStatus({
      status: "running",
      succeeded: true,
      attempts: 1,
    })).toBe("completed");
  });

  it("permite uma única recuperação estrutural antes de pausar", () => {
    expect(nextBackgroundJobStatus({
      status: "running",
      succeeded: false,
      attempts: 1,
      retryable: true,
    })).toBe("retry");
    expect(BACKGROUND_MAX_ATTEMPTS).toBe(2);
  });

  it("repete somente falha estrutural e não repete saldo ou timeout", () => {
    expect(isRetryableBackgroundFailure("OpenRouter: HTTP 402 — sem saldo.")).toBe(false);
    expect(isRetryableBackgroundFailure("O modelo não respondeu dentro do tempo limite.")).toBe(false);
    expect(isRetryableBackgroundFailure("O código falhou no quality gate.")).toBe(true);
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
    expect(isBackgroundGenerationPayload({ ...payload, version: 1 })).toBe(true);
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

  it("carrega o snapshot para a próxima etapa sem expor resultado parcial", () => {
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
        nextStage: 0,
        startedAt: "2026-01-01T00:00:00.000Z",
      },
      stageIndex: 0,
      requestId: "request-1",
      reservationId: "reservation-1",
      name: "Meu app",
      costMode: "premium" as const,
      queuedAt: "2026-01-01T00:00:00.000Z",
    };
    const result = {
      reply: "Etapa pronta",
      plan: ["Base"],
      app: {
        kind: "app" as const,
        name: "Meu app",
        description: "",
        code: "export default function App(){ return <main>Pronto</main> }",
      },
      provider: "openrouter" as const,
      engineMode: "real" as const,
      cost: 0.25,
    };

    const transition = advanceBackgroundGeneration(
      payload,
      result,
      3,
      1_500,
      "2026-01-01T00:01:00.000Z"
    );

    expect(transition.completed).toBe(false);
    expect(transition.payload.stageIndex).toBe(1);
    expect(transition.payload.stagedJob.nextStage).toBe(1);
    expect(transition.payload.currentApp).toEqual(result.app);
    expect(transition.payload.result).toBeUndefined();
    expect(transition.totalCost).toBe(0.25);
    expect(transition.totalDurationMs).toBe(1_500);
  });

  it("só entrega o resultado depois da última etapa e soma custo e duração", () => {
    const app = {
      kind: "app" as const,
      name: "Meu app",
      description: "",
      code: "export default function App(){ return <main>Final</main> }",
    };
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
        startedAt: "2026-01-01T00:00:00.000Z",
      },
      stageIndex: 2,
      requestId: "request-1",
      reservationId: "reservation-1",
      name: "Meu app",
      costMode: "premium" as const,
      queuedAt: "2026-01-01T00:02:00.000Z",
      currentApp: app,
      accumulatedCost: 0.4,
      accumulatedDurationMs: 3_000,
    };
    const result = {
      reply: "Projeto pronto",
      plan: ["Entrega"],
      app,
      provider: "openrouter" as const,
      engineMode: "real" as const,
      cost: 0.1,
    };

    const transition = advanceBackgroundGeneration(
      payload,
      result,
      3,
      800,
      "2026-01-01T00:03:00.000Z"
    );

    expect(transition.completed).toBe(true);
    expect(transition.totalCost).toBeCloseTo(0.5);
    expect(transition.totalDurationMs).toBe(3_800);
    expect(transition.payload.result).toMatchObject({ app, cost: 0.5 });
  });

  it("explica o estado da fila em linguagem de interface", () => {
    expect(backgroundJobLabel("queued")).toBe("Na fila · aguardando execução");
    expect(backgroundJobLabel("running")).toBe("Gerando etapa");
    expect(backgroundJobLabel("running", 1)).toBe("Gerando etapa · tentativa 1/2");
    expect(backgroundJobLabel("running", 2)).toBe("Gerando etapa · tentativa 2/2");
    expect(backgroundJobLabel("running", 5)).toBe("Gerando etapa · tentativa 2/2");
    expect(backgroundJobLabel("retry", 1)).toBe("Etapa aguardando nova tentativa · 2/2");
    expect(backgroundJobLabel("completed")).toBe("Concluído · aplicando resultado");
  });
});

describe("salvamento da etapa final (entrega o app quando só a revisão falha)", () => {
  const app = {
    kind: "app" as const,
    name: "Esmalteria",
    description: "",
    files: [
      { path: "App.jsx", content: "export default function App(){ return <main>Esmalteria</main> }" },
      { path: "components/Agenda.jsx", content: "export default function Agenda(){ return <div>Agenda</div> }" },
    ],
    entry: "App.jsx",
  };
  const basePayload = {
    version: BACKGROUND_GENERATION_VERSION,
    projectId: "project-1",
    threadId: "thread-1",
    userId: "user-1",
    stagedJob: {
      version: 1,
      projectId: "project-1",
      threadId: "thread-1",
      originalPrompt: "Crie a esmalteria",
      masterPrompt: "Crie a esmalteria completa",
      kind: "initial" as const,
      nextStage: 6,
      startedAt: "2026-01-01T00:00:00.000Z",
    },
    stageIndex: 6,
    requestId: "request-1",
    reservationId: "reservation-1",
    name: "Esmalteria",
    costMode: "premium" as const,
    queuedAt: "2026-01-01T00:00:00.000Z",
    currentApp: app,
    accumulatedCost: 0.42,
  };

  it("entrega o app acumulado quando a ÚLTIMA etapa (7 de 7) falha", () => {
    const salvaged = salvageFinalStageResult(basePayload, 7);
    expect(salvaged).not.toBeNull();
    expect(salvaged?.app).toEqual(app);
    expect(salvaged?.engineMode).toBe("real");
    expect(salvaged?.cost).toBe(0.42);
    expect(salvaged?.stats?.files).toBe(2);
  });

  it("NÃO salva quando a etapa que falhou não é a final", () => {
    expect(salvageFinalStageResult({ ...basePayload, stageIndex: 2 }, 7)).toBeNull();
  });

  it("NÃO salva na primeira etapa (não há snapshot anterior)", () => {
    expect(salvageFinalStageResult({ ...basePayload, stageIndex: 0 }, 1)).toBeNull();
  });

  it("NÃO salva quando não há app acumulado válido", () => {
    const { currentApp: _omit, ...noApp } = basePayload;
    void _omit;
    expect(salvageFinalStageResult(noApp, 7)).toBeNull();
  });
});
