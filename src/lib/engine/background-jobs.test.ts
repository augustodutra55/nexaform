import { describe, expect, it } from "vitest";
import {
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
});
