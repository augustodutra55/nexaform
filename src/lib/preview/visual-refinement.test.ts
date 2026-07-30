import { describe, expect, it } from "vitest";
import {
  buildVisualRefinementRecoveryPrompt,
  createVisualRefinementBaseline,
  verifyVisualRefinement,
  verifyVisualRefinementBaseline,
} from "./visual-refinement";

const selection = {
  tag: "button",
  selector: "button.cta",
  label: "Agendar avaliação",
  text: "Agendar avaliação",
  role: "button",
  nearbyText: "Implantodontia Agendar avaliação",
};

describe("visual refinement verification", () => {
  const before = [
    { path: "App.jsx", content: "import Hero from './components/Hero.jsx'" },
    { path: "components/Hero.jsx", content: "export default () => <button>Agendar avaliação</button>" },
    { path: "components/Footer.jsx", content: "export default () => <footer>Clínica</footer>" },
  ];
  const candidates = [{ path: "components/Hero.jsx", score: 20, evidence: "<button>Agendar avaliação</button>" }];

  it("aprova quando o arquivo-fonte provável mudou", () => {
    const result = verifyVisualRefinement(null, before, {
      kind: "app",
      name: "Clínica",
      description: "Landing odontológica",
      files: before.map((file) => file.path === "components/Hero.jsx"
        ? { ...file, content: "export default () => <button>Falar no WhatsApp</button>" }
        : file),
      entry: "App.jsx",
    }, candidates);
    expect(result.valid).toBe(true);
    expect(result.reason).toBe("target_changed");
    expect(result.changedPaths).toEqual(["components/Hero.jsx"]);
  });

  it("recusa resposta sem qualquer alteração", () => {
    const result = verifyVisualRefinement(null, before, {
      kind: "app",
      name: "Clínica",
      description: "Landing odontológica",
      files: before,
      entry: "App.jsx",
    }, candidates);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("no_change");
  });

  it("recusa alteração distante quando a correspondência é forte", () => {
    const result = verifyVisualRefinement(null, before, {
      kind: "app",
      name: "Clínica",
      description: "Landing odontológica",
      files: before.map((file) => file.path === "components/Footer.jsx"
        ? { ...file, content: "export default () => <footer>Nova clínica</footer>" }
        : file),
      entry: "App.jsx",
    }, candidates);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("target_not_changed");
    expect(result.expectedPaths).toEqual(["components/Hero.jsx"]);
  });

  it("aceita qualquer mudança real quando não há candidato forte", () => {
    const result = verifyVisualRefinement(null, before, {
      kind: "app",
      name: "Clínica",
      description: "Landing odontológica",
      files: before.map((file) => file.path === "components/Footer.jsx"
        ? { ...file, content: "export default () => <footer>Nova clínica</footer>" }
        : file),
      entry: "App.jsx",
    }, [{ path: "components/Footer.jsx", score: 3, evidence: "Clínica" }]);
    expect(result.valid).toBe(true);
    expect(result.reason).toBe("project_changed");
  });

  it("gera uma recuperação cirúrgica com evidência do alvo", () => {
    const prompt = buildVisualRefinementRecoveryPrompt({
      originalRequest: "Troque o texto do botão para falar no WhatsApp",
      selection,
      candidates,
      verification: {
        valid: false,
        changedPaths: ["components/Footer.jsx"],
        expectedPaths: ["components/Hero.jsx"],
        reason: "target_not_changed",
      },
    });
    expect(prompt).toContain("segunda e última tentativa");
    expect(prompt).toContain("components/Hero.jsx");
    expect(prompt).toContain("components/Footer.jsx");
    expect(prompt).toContain("AD_PATCH");
  });

  it("mantém a verificação após uma retomada usando somente assinaturas", () => {
    const baseline = createVisualRefinementBaseline(null, before);
    const result = verifyVisualRefinementBaseline(baseline, {
      kind: "app",
      name: "Clínica",
      description: "Landing odontológica",
      files: before.map((file) => file.path === "components/Hero.jsx"
        ? { ...file, content: "export default () => <button>WhatsApp</button>" }
        : file),
      entry: "App.jsx",
    }, candidates);
    expect(result.valid).toBe(true);
    expect(result.changedPaths).toEqual(["components/Hero.jsx"]);
    expect(baseline[0]).not.toHaveProperty("content");
  });
});
