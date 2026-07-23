import { describe, expect, it } from "vitest";
import {
  buildVisualSelectionContext,
  findPreviewSourceCandidates,
  normalizePreviewSelection,
} from "./visual-selection";

describe("visual selection", () => {
  it("normaliza dados vindos do iframe e limita conteúdo", () => {
    const selection = normalizePreviewSelection({
      tag: "BUTTON",
      selector: "button.cta",
      text: "  Agendar   agora ",
      role: "button",
      label: "",
      nearbyText: "Hero da clínica",
    });
    expect(selection).toEqual({
      tag: "button",
      selector: "button.cta",
      text: "Agendar agora",
      role: "button",
      label: "Agendar agora",
      nearbyText: "Hero da clínica",
    });
  });

  it("recusa mensagens sem elemento identificável", () => {
    expect(normalizePreviewSelection({ text: "sem seletor" })).toBeNull();
    expect(normalizePreviewSelection(null)).toBeNull();
  });

  it("gera contexto de edição cirúrgica", () => {
    const context = buildVisualSelectionContext({
      tag: "h2",
      selector: "section.services h2",
      label: "Serviços",
      text: "Nossos serviços",
      role: "",
      nearbyText: "Nossos serviços Implantodontia Ortodontia",
    });
    expect(context).toContain("Elemento selecionado no preview: <h2>");
    expect(context).toContain("Nossos serviços");
    expect(context).toContain("edição cirúrgica em ops");
  });

  it("localiza o componente provável pelo texto selecionado", () => {
    const selection = {
      tag: "button",
      selector: "button.cta",
      label: "Agendar avaliação",
      text: "Agendar avaliação",
      role: "button",
      nearbyText: "Implantodontia avançada Agendar avaliação",
    };
    const candidates = findPreviewSourceCandidates(selection, [
      { path: "components/Header.jsx", content: "export default function Header(){ return <header>Clínica</header> }" },
      {
        path: "components/Implantodontia.jsx",
        content: "export default function Implantodontia(){ return <button>Agendar avaliação</button> }",
      },
      { path: "App.jsx", content: "import Implantodontia from './components/Implantodontia.jsx'" },
    ]);
    expect(candidates[0]?.path).toBe("components/Implantodontia.jsx");
    expect(candidates[0]?.evidence).toContain("Agendar avaliação");
    expect(candidates.some((candidate) => candidate.path === "components/Header.jsx")).toBe(false);

    const context = buildVisualSelectionContext(selection, candidates);
    expect(context).toContain("Arquivos-fonte prováveis");
    expect(context).toContain("components/Implantodontia.jsx");
  });

  it("não inventa arquivo quando não há correspondência", () => {
    const candidates = findPreviewSourceCandidates(
      {
        tag: "img",
        selector: "img.hero",
        label: "Imagem dinâmica",
        text: "",
        role: "",
        nearbyText: "",
      },
      [{ path: "App.jsx", content: "export default function App(){ return null }" }]
    );
    expect(candidates).toEqual([]);
  });
});
