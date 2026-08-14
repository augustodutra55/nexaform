import { describe, expect, it } from "vitest";
import { buildReleaseCertification, type ReadinessCheck } from "./readiness";

const required: ReadinessCheck[] = [
  "release-core-ci",
  "release-e2e-ci",
  "background-worker",
  "migration-0014",
  "migration-0015",
  "migration-0009",
  "migration-0010",
  "migration-0012",
  "migration-0011",
  "supabase-public",
  "service-role",
  "migration-0013",
].map((id) => ({ id, label: id, detail: "ok", status: "ready" }));

describe("certificação 12/12", () => {
  it("só certifica quando todas as capacidades dinâmicas estão prontas", () => {
    const report = buildReleaseCertification(required);
    expect(report.certified).toBe(true);
    expect(report.ready).toBe(12);
    expect(report.score).toBe(100);
    expect(report.gates.map((gate) => gate.number)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1)
    );
  });


  it("não certifica capacidades estáticas sem CI comprovado para o commit", () => {
    const report = buildReleaseCertification(required.filter((check) => check.id !== "release-core-ci"));
    expect(report.certified).toBe(false);
    expect(report.ready).toBe(5);
    expect(report.gates.find((gate) => gate.id === "architecture")?.status).toBe("warning");
    expect(report.gates.find((gate) => gate.id === "interaction-tests")?.status).toBe("warning");
  });


  it("não aprova interações nem editor visual quando somente o build principal passou", () => {
    const report = buildReleaseCertification(required.filter((check) => check.id !== "release-e2e-ci"));
    expect(report.certified).toBe(false);
    expect(report.ready).toBe(10);
    expect(report.gates.find((gate) => gate.id === "interaction-tests")?.status).toBe("warning");
    expect(report.gates.find((gate) => gate.id === "visual-editor")?.status).toBe("warning");
  });

  it("expõe o bloqueio real sem declarar 10/10", () => {
    const checks = required.map((check) => check.id === "migration-0013"
      ? { ...check, status: "blocked" as const, detail: "Migração ausente.", action: "Aplique 0013." }
      : check);
    const report = buildReleaseCertification(checks);
    const observability = report.gates.find((gate) => gate.id === "observability");
    expect(report.certified).toBe(false);
    expect(report.ready).toBe(11);
    expect(observability?.status).toBe("blocked");
    expect(observability?.action).toBe("Aplique 0013.");
  });
});
