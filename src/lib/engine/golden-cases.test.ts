import { describe, expect, it } from "vitest";
import { buildGenerationPlan } from "./generation-plan";
import { GOLDEN_CASES } from "./golden-cases";

describe("golden suite de paridade", () => {
  it("mantém cinco cenários comerciais distintos", () => {
    expect(GOLDEN_CASES.map((item) => item.id)).toEqual([
      "landing",
      "agenda",
      "dashboard",
      "commerce",
      "media",
    ]);
  });

  for (const item of GOLDEN_CASES) {
    it(`${item.id}: produz contrato determinístico compatível`, () => {
      const plan = buildGenerationPlan(item.prompt, item.mediaAssets ?? []);
      expect(plan.kind).toBe(item.expectedKind);
      expect(plan.visualProfile.id).toBe(item.expectedProfile);
      for (const capability of item.requiredCapabilities) {
        expect(plan.requiredCapabilities).toContain(capability);
      }
      if (item.expectedVideoMode) expect(plan.media.videoMode).toBe(item.expectedVideoMode);
      expect(plan.acceptanceCriteria).toContain("projeto multi-arquivo com App.jsx fino e imports resolvíveis");
      expect(plan.acceptanceCriteria).toContain("fluxo principal utilizável, sem botões decorativos ou telas sem saída");
      expect(plan.acceptanceCriteria).toContain("desktop e mobile responsivos, com acessibilidade e feedback de erro");
    });
  }
});
