import { describe, expect, it } from "vitest";
import { evaluateGoldenCandidate } from "../../../scripts/lib/golden-evaluator.mjs";

function candidate(files: Array<{ path: string; content: string }>) {
  return {
    engineMode: "real",
    quality: { valid: true, score: 100 },
    app: { entry: "App.jsx", files },
  };
}

describe("Golden 2.0 evaluator", () => {
  it("aprova uma landing multi-arquivo com evidências do pedido", () => {
    const result = evaluateGoldenCandidate("landing", candidate([
      {
        path: "App.jsx",
        content: 'import Page from "./Page"; export default function App(){ return <Page/> }',
      },
      {
        path: "Page.jsx",
        content: `export default function Page(){ return <main><h1>Consultoria</h1><p>Benefícios e resultados para clientes</p><form onSubmit={()=>{}}><button>Fale conosco</button></form><section>Depoimentos</section><section>FAQ</section></main> }`,
      },
    ]));
    expect(result.passed).toBe(true);
    expect(result.score).toBe(100);
  });

  it("bloqueia import quebrado e sintaxe inválida", () => {
    const result = evaluateGoldenCandidate("landing", candidate([
      { path: "App.jsx", content: 'import Missing from "./Missing"; export default function App(){ return <Missing> }' },
      { path: "Other.jsx", content: "export default function Other(){ return <div/> }" },
    ]));
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain("imports");
    expect(result.blockers).toContain("syntax");
  });

  it("reprova projeto executável que não cumpre o cenário", () => {
    const result = evaluateGoldenCandidate("commerce", candidate([
      { path: "App.jsx", content: 'import Empty from "./Empty"; export default function App(){ return <Empty/> }' },
      { path: "Empty.jsx", content: "export default function Empty(){ return <main><h1>Olá</h1></main> }" },
    ]));
    expect(result.passed).toBe(false);
    expect(result.semanticRate).toBe(0);
  });

  it("ignora arquivos auxiliares e reconhece finalizar pedido como checkout", () => {
    const result = evaluateGoldenCandidate("commerce", candidate([
      { path: "App.jsx", content: 'import Shop from "./Shop"; export default function App(){ return <Shop/> }' },
      { path: "README.md", content: "Documentação do projeto" },
      { path: "Shop.jsx", content: `export default function Shop(){ return <main><input placeholder="Busca"/><h1>Catálogo de produtos</h1><p>Preço R$ 20</p><button>Carrinho</button><button>Finalizar pedido</button><section>Depoimentos de clientes</section><section>FAQ</section></main> }` },
    ]));
    expect(result.passed).toBe(true);
    expect(result.checks.find((item: { id: string }) => item.id === "semantic-checkout")?.passed).toBe(true);
  });

  it("não dá crédito semântico a componentes órfãos", () => {
    const result = evaluateGoldenCandidate("commerce", candidate([
      { path: "App.jsx", content: 'import Shop from "./Shop"; export default function App(){ return <Shop/> }' },
      { path: "Shop.jsx", content: `export default function Shop(){ return <main><input placeholder="Busca"/><h1>Catálogo de produtos</h1><p>Preço R$ 20</p><button>Carrinho</button><button>Finalizar pedido</button></main> }` },
      { path: "FAQ.jsx", content: "export default function FAQ(){ return <section>FAQ</section> }" },
      { path: "SocialProof.jsx", content: "export default function SocialProof(){ return <section>Depoimentos de clientes</section> }" },
    ]));

    expect(result.passed).toBe(false);
    expect(result.semanticRate).toBe(71);
    expect(result.checks.find((item: { id: string }) => item.id === "semantic-faq")?.passed).toBe(false);
    expect(result.checks.find((item: { id: string }) => item.id === "semantic-social-proof")?.passed).toBe(false);
  });
});
