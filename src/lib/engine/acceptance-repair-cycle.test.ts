import { describe, expect, it } from "vitest";
import { appCodeFingerprint, evaluateRepairCandidate } from "./acceptance-repair-cycle";

const startedAt = "2026-08-03T12:00:00.000Z";
const app = (content: string) => ({ kind: "app" as const, name: "Teste", description: "", code: content });
const runtime = (codes: string[] = [], checkedAt = Date.parse(startedAt) + 1000) => ({
  issues: codes.map((code) => ({ code, severity: "error" as const, message: code })),
  stats: { buttons: 1, links: 0, forms: 0, inputs: 0, images: 0 },
  viewport: { width: 390, height: 844, overflowX: 0 },
  checkedAt,
});

describe("ciclo de reparo do aceite", () => {
  it("produz a mesma assinatura para arquivos em ordens diferentes", () => {
    const first = { kind: "app" as const, name: "A", description: "", entry: "App.jsx", files: [
      { path: "App.jsx", content: "export default 1" },
      { path: "Card.jsx", content: "export default 2" },
    ] };
    const second = { ...first, files: first.files.slice().reverse() };
    expect(appCodeFingerprint(first)).toBe(appCodeFingerprint(second));
  });

  it("recusa uma resposta que não alterou o código", () => {
    const candidate = app("export default function App() { return null }");
    const result = evaluateRepairCandidate({
      baselineAppFingerprint: appCodeFingerprint(candidate), baselineIssueCodes: ["crash"],
      candidate, runtime: runtime(), repairStartedAt: startedAt,
    });
    expect(result.reason).toBe("unchanged");
  });

  it("recusa auditoria antiga para não aprovar evidência da versão anterior", () => {
    const result = evaluateRepairCandidate({
      baselineAppFingerprint: appCodeFingerprint(app("quebrado")), baselineIssueCodes: ["crash"],
      candidate: app("corrigido"), runtime: runtime([], Date.parse(startedAt) - 1), repairStartedAt: startedAt,
    });
    expect(result.reason).toBe("audit_missing");
  });

  it("aprova código diferente depois de auditoria limpa e registra a falha resolvida", () => {
    const result = evaluateRepairCandidate({
      baselineAppFingerprint: appCodeFingerprint(app("quebrado")), baselineIssueCodes: ["crash"],
      candidate: app("corrigido"), runtime: runtime(), repairStartedAt: startedAt,
    });
    expect(result.approved).toBe(true);
    expect(result.resolvedIssueCodes).toEqual(["crash"]);
  });
});
