import { describe, expect, it } from "vitest";
import {
  classifyGenerationFailure,
  safeOperationalMessage,
  summarizeGenerationMetrics,
} from "./observability";

describe("observabilidade operacional", () => {
  it("classifica causas conhecidas sem depender do provedor", () => {
    expect(classifyGenerationFailure("HTTP 402: sem saldo")).toBe("credits");
    expect(classifyGenerationFailure("A geração passou do tempo limite")).toBe("timeout");
    expect(classifyGenerationFailure("resposta não pôde ser interpretada como código")).toBe("invalid_format");
    expect(classifyGenerationFailure("OpenRouter HTTP 503")).toBe("provider");
  });

  it("remove credenciais das mensagens", () => {
    const value = safeOperationalMessage("Bearer abc.def.secret e sk-or-1234567890abcdef");
    expect(value).not.toContain("abc.def.secret");
    expect(value).not.toContain("1234567890abcdef");
  });

  it("resume custo, sucesso e latência", () => {
    const result = summarizeGenerationMetrics([
      { status: "completed", cost_usd: 0.1, duration_ms: 100 },
      { status: "completed", cost_usd: "0.2", duration_ms: 300 },
      { status: "failed", cost_usd: 0, duration_ms: 200, error_code: "timeout" },
      { status: "pending", cost_usd: 0 },
    ]);
    expect(result).toMatchObject({
      total: 4, completed: 2, failed: 1, pending: 1,
      successRate: 66.7, cost: 0.3, averageDurationMs: 200, p95DurationMs: 300,
      failures: { timeout: 1 },
    });
  });
});
