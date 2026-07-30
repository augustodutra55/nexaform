import { describe, expect, it } from "vitest";
import { probeCheck, summarizeReadiness } from "./readiness";

describe("system readiness", () => {
  it("bloqueia quando um requisito obrigatório está ausente", () => {
    const report = summarizeReadiness([
      probeCheck({
        id: "database",
        label: "Banco",
        ok: true,
        readyDetail: "Ativo",
        missingDetail: "Ausente",
      }),
      probeCheck({
        id: "service-role",
        label: "Service role",
        ok: false,
        readyDetail: "Ativa",
        missingDetail: "Não configurada",
        action: "Configure na Vercel.",
      }),
    ], "2026-07-30T12:00:00.000Z");

    expect(report.status).toBe("blocked");
    expect(report.ready).toBe(1);
    expect(report.total).toBe(2);
  });

  it("trata provedor de IA do servidor como recomendação", () => {
    const report = summarizeReadiness([
      probeCheck({
        id: "openrouter",
        label: "IA",
        ok: false,
        readyDetail: "Ativa",
        missingDetail: "Usando somente chaves do navegador",
        optional: true,
      }),
    ]);

    expect(report.status).toBe("warning");
    expect(report.checks[0].status).toBe("warning");
  });
});
