import { describe, expect, it } from "vitest";
import { evaluateRefinementPreservation, filesForRefinement } from "./golden-refinement.mjs";

const before = {
  files: [
    { path: "App.jsx", content: "import Hero from './Hero';\nexport default function App(){ return <Hero />; }" },
    { path: "Hero.jsx", content: "export default function Hero(){ return <><h1>Consultoria</h1><button>Fale conosco</button><p>Estratégia para crescer.</p></>; }" },
    { path: "styles.css", content: ".hero { color: navy; padding: 48px; }" },
  ],
};

describe("certificação Golden de refinamento", () => {
  it("aprova uma alteração cirúrgica que preserva os demais arquivos", () => {
    const after = {
      files: before.files.map((file) => file.path === "Hero.jsx"
        ? { ...file, content: file.content.replace("Fale conosco", "Agendar diagnóstico estratégico") }
        : file),
    };
    const result = evaluateRefinementPreservation(before, after, "Agendar diagnóstico estratégico");
    expect(result.passed).toBe(true);
    expect(result.targetPresent).toBe(true);
    expect(result.changedFiles).toEqual(["Hero.jsx"]);
    expect(result.missingFiles).toEqual([]);
    expect(result.preservationRate).toBeGreaterThanOrEqual(90);
  });

  it("recusa uma reescrita ampla mesmo que o novo texto apareça", () => {
    const after = {
      files: [
        { path: "App.jsx", content: "export default function App(){ return <button>Agendar diagnóstico estratégico</button>; }" },
        { path: "Hero.jsx", content: "export default function Hero(){ return null; }" },
        { path: "styles.css", content: "* { all: unset; }" },
      ],
    };
    const result = evaluateRefinementPreservation(before, after, "Agendar diagnóstico estratégico");
    expect(result.passed).toBe(false);
    expect(result.targetPresent).toBe(true);
    expect(result.preservationRate).toBeLessThan(90);
  });

  it("recusa a remoção silenciosa de arquivos", () => {
    const after = {
      files: [
        before.files[0],
        { path: "Hero.jsx", content: before.files[1].content.replace("Fale conosco", "Agendar diagnóstico estratégico") },
      ],
    };
    const result = evaluateRefinementPreservation(before, after, "Agendar diagnóstico estratégico");
    expect(result.passed).toBe(false);
    expect(result.missingFiles).toEqual(["styles.css"]);
  });

  it("converte apps legados em arquivo refinável", () => {
    expect(filesForRefinement({ code: "export default function App(){}" })).toEqual([
      { path: "App.jsx", content: "export default function App(){}" },
    ]);
  });
});
