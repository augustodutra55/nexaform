import { describe, expect, it } from "vitest";
import { buildVisualSelectionContext, normalizePreviewSelection } from "./visual-selection";

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
});
