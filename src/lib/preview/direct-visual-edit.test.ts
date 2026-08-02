import { describe, expect, it } from "vitest";
import { applyDirectVisualLinkEdit, applyDirectVisualStyleEdit, applyDirectVisualTextEdit } from "./direct-visual-edit";

const selection = {
  tag: "h2",
  selector: "h2.title",
  label: "Nossos serviços",
  text: "Nossos serviços",
  role: "",
  nearbyText: "Nossos serviços para sua empresa",
  className: "text-left font-normal",
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

  it("preserva o ícone ao editar o texto literal de um botão composto", () => {
    const buttonSelection = { ...selection, tag: "button", text: "Agendar agora" };
    const result = applyDirectVisualTextEdit(
      [{ path: "Cta.jsx", content: "export default () => <button><Calendar className=\"h-4 w-4\" /> Agendar agora</button>" }],
      buttonSelection,
      "Marcar consulta"
    );
    expect(result.changed).toBe(true);
    expect(result.files[0].content).toContain('<Calendar className="h-4 w-4" /> Marcar consulta');
  });

  it("edita texto literal dentro de marcação sem remover a estrutura", () => {
    const buttonSelection = { ...selection, tag: "button", text: "Comprar" };
    const result = applyDirectVisualTextEdit(
      [{ path: "Cta.jsx", content: "export default () => <button><span>Comprar</span></button>" }],
      buttonSelection,
      "Conhecer plano"
    );
    expect(result.changed).toBe(true);
    expect(result.files[0].content).toContain("<span>Conhecer plano</span>");
  });

  it("deixa textos divididos entre vários filhos para o refinamento por IA", () => {
    const result = applyDirectVisualTextEdit(
      [{ path: "App.jsx", content: "export default () => <h2>Nossos <strong>serviços</strong></h2>" }],
      selection,
      "Soluções"
    );
    expect(result.changed).toBe(false);
    expect(result.reason).toBe("source_not_found");
  });
});

describe("direct visual style edit", () => {
  it("aplica preset e substitui classes conflitantes", () => {
    const result = applyDirectVisualStyleEdit(
      [{ path: "Hero.jsx", content: 'export default () => <h2 className="text-left font-normal">Nossos serviços</h2>' }],
      selection,
      "centered"
    );
    expect(result.changed).toBe(true);
    expect(result.files[0].content).toContain('className="font-normal text-center"');
  });

  it("adiciona className quando o elemento ainda não possui", () => {
    const result = applyDirectVisualStyleEdit(
      [{ path: "Card.jsx", content: "export default () => <h2>Nossos serviços</h2>" }],
      selection,
      "rounded"
    );
    expect(result.changed).toBe(true);
    expect(result.files[0].content).toContain('className="rounded-2xl shadow-lg"');
  });

  it("recusa className dinâmico", () => {
    const result = applyDirectVisualStyleEdit(
      [{ path: "Card.jsx", content: "export default () => <h2 className={active ? 'a' : 'b'}>Nossos serviços</h2>" }],
      selection,
      "emphasis"
    );
    expect(result.changed).toBe(false);
    expect(result.reason).toBe("unsupported_element");
  });

  it("aumenta o texto removendo apenas o tamanho conflitante", () => {
    const result = applyDirectVisualStyleEdit(
      [{ path: "Hero.jsx", content: 'export default () => <h2 className="text-sm font-bold text-slate-900">Nossos serviços</h2>' }],
      selection,
      "larger"
    );
    expect(result.changed).toBe(true);
    expect(result.files[0].content).toContain('className="font-bold text-slate-900 text-2xl"');
  });

  it("aplica estilo primário sem conservar cores conflitantes", () => {
    const result = applyDirectVisualStyleEdit(
      [{ path: "Cta.jsx", content: 'export default () => <button className="bg-red-500 text-slate-900 hover:bg-red-600 px-4">Nossos serviços</button>' }],
      { ...selection, tag: "button" },
      "primary"
    );
    expect(result.changed).toBe(true);
    expect(result.files[0].content).toContain('className="px-4 bg-violet-600 text-white hover:bg-violet-700 transition-colors"');
  });

  it("permite tornar o elemento compacto e ocupar toda a largura em sequência", () => {
    const initial = [{ path: "Card.jsx", content: 'export default () => <h2 className="p-8 w-auto">Nossos serviços</h2>' }];
    const compact = applyDirectVisualStyleEdit(initial, selection, "compact");
    const full = applyDirectVisualStyleEdit(compact.files, selection, "fullWidth");
    expect(full.changed).toBe(true);
    expect(full.files[0].content).toContain('className="p-3 w-full"');
  });
});

describe("direct visual link edit", () => {
  const linkSelection = { ...selection, tag: "a", text: "Agendar", href: "/agendar" };

  it("altera um href literal identificado pelo texto", () => {
    const result = applyDirectVisualLinkEdit(
      [{ path: "Header.jsx", content: '<a href="/agendar">Agendar</a>' }],
      linkSelection,
      "https://empresa.com/agenda?origem=site&canal=cta"
    );
    expect(result.changed).toBe(true);
    expect(result.files[0].content).toContain('href="https://empresa.com/agenda?origem=site&amp;canal=cta"');
  });

  it("recusa protocolos executáveis", () => {
    const result = applyDirectVisualLinkEdit(
      [{ path: "Header.jsx", content: '<a href="/agendar">Agendar</a>' }],
      linkSelection,
      "javascript:alert(1)"
    );
    expect(result.changed).toBe(false);
    expect(result.reason).toBe("unsafe_value");
  });

  it("usa o texto para diferenciar links com o mesmo destino", () => {
    const result = applyDirectVisualLinkEdit(
      [{ path: "App.jsx", content: '<><a href="/agendar">Agendar</a><a href="/agendar">Contato</a></>' }],
      linkSelection,
      "#formulario"
    );
    expect(result.changed).toBe(true);
    expect(result.files[0].content).toContain('<a href="#formulario">Agendar</a>');
    expect(result.files[0].content).toContain('<a href="/agendar">Contato</a>');
  });
});
