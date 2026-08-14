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
});
