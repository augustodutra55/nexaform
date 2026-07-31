import { describe, expect, it } from "vitest";
import { applyDirectVisualTextEdit } from "./direct-visual-edit";

const selection = {
  tag: "h2",
  selector: "h2.title",
  label: "Nossos serviços",
  text: "Nossos serviços",
  role: "",
  nearbyText: "Nossos serviços para sua empresa",
};

describe("direct visual edit", () => {
  it("edita um texto JSX único no arquivo correto", () => {
    const result = applyDirectVisualTextEdit(
      [
        { path: "App.jsx", content: "import Servicos from './Servicos.jsx'" },
        { path: "Servicos.jsx", content: "export default () => <h2>\n  Nossos serviços\n</h2>" },
      ],
      selection,
      "Soluções para sua empresa"
    );
    expect(result.changed).toBe(true);
    expect(result.path).toBe("Servicos.jsx");
    expect(result.files[1].content).toContain("Soluções para sua empresa");
  });

  it("escapa caracteres reservados do JSX", () => {
    const result = applyDirectVisualTextEdit(
      [{ path: "App.jsx", content: "export default () => <h2>Nossos serviços</h2>" }],
      selection,
      "Planos < 10 {dias} & suporte"
    );
    expect(result.files[0].content).toContain("Planos &lt; 10 &#123;dias&#125; &amp; suporte");
  });

  it("recusa texto repetido para não editar o alvo errado", () => {
    const result = applyDirectVisualTextEdit(
      [{ path: "App.jsx", content: "export default () => <><h2>Nossos serviços</h2><h2>Nossos serviços</h2></>" }],
      selection,
      "Soluções"
    );
    expect(result.changed).toBe(false);
    expect(result.reason).toBe("ambiguous_source");
  });

  it("considera a tag selecionada ao localizar o texto", () => {
    const result = applyDirectVisualTextEdit(
      [
        {
          path: "App.jsx",
          content: "export default () => <><p>Nossos serviços</p><h2>Nossos serviços</h2></>",
        },
      ],
      selection,
      "Soluções"
    );
    expect(result.changed).toBe(true);
    expect(result.files[0].content).toContain("<p>Nossos serviços</p>");
    expect(result.files[0].content).toContain("<h2>Soluções</h2>");
  });

  it("deixa elementos compostos para o refinamento por IA", () => {
    const result = applyDirectVisualTextEdit(
      [{ path: "App.jsx", content: "export default () => <h2>Nossos <strong>serviços</strong></h2>" }],
      selection,
      "Soluções"
    );
    expect(result.changed).toBe(false);
    expect(result.reason).toBe("source_not_found");
  });
});
