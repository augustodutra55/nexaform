import { describe, expect, it } from "vitest";
import { applyFileOperations, parseOperationBlocks } from "./operation-blocks";

describe("aplicação transacional de operações", () => {
  const current = [
    { path: "App.jsx", content: "export default function App(){ return <main /> }" },
    { path: "Page.jsx", content: "export default function Page(){ return <p>Antes</p> }" },
  ];

  it("ignora arquivo repetido quando outra operação do lote muda o projeto", () => {
    const result = applyFileOperations(current, [
      { op: "update", path: "App.jsx", content: current[0].content },
      { op: "update", path: "Page.jsx", content: "export default function Page(){ return <p>Depois</p> }" },
    ]);
    expect(result).toEqual([
      current[0],
      { path: "Page.jsx", content: "export default function Page(){ return <p>Depois</p> }" },
    ]);
  });

  it("continua recusando um lote composto somente de no-ops", () => {
    expect(applyFileOperations(current, [
      { op: "update", path: "App.jsx", content: current[0].content },
    ])).toBeNull();
  });

  it("combina AD_FILE no-op com a mudança real de um envelope JSON", () => {
    const parsed = parseOperationBlocks(`<AD_FILE path="App.jsx" op="update">
${current[0].content}
</AD_FILE>
{"ops":[{"op":"update","path":"Page.jsx","content":"export default function Page(){ return <p>Depois</p> }"}]}`);

    expect(parsed).not.toBeNull();
    expect(applyFileOperations(current, parsed!.ops)).toEqual([
      current[0],
      { path: "Page.jsx", content: "export default function Page(){ return <p>Depois</p> }" },
    ]);
  });

  it("combina AD_FILE com arquivo em JSON-like cercado", () => {
    const parsed = parseOperationBlocks(`<AD_FILE path="App.jsx" op="update">
${current[0].content}
</AD_FILE>
"Page.jsx": \`\`\`jsx
export default function Page(){ return <p>Depois</p> }
\`\`\``);

    expect(applyFileOperations(current, parsed!.ops)?.[1].content).toContain("Depois");
  });
});

describe("salvamento de AD_FILE truncado (Etapa 2/7 — Esmalteria)", () => {
  it("recupera o último AD_FILE sem tag de fechamento", () => {
    const text = `<AD_FILE path="components/Agendamento.jsx" op="create">
export default function Agendamento(){
  return <div className="p-4">Agenda da esmalteria</div>;
}`; // truncado: sem </AD_FILE>
    const r = parseOperationBlocks(text);
    expect(r).not.toBeNull();
    expect(r?.ops.length).toBe(1);
    expect(r?.ops[0]).toMatchObject({ op: "create", path: "components/Agendamento.jsx" });
    expect((r?.ops[0] as any).content).toContain("function Agendamento");
  });

  it("preserva arquivos fechados e ainda recupera o último truncado", () => {
    const text = `<AD_FILE path="components/Servicos.jsx" op="create">
export default function Servicos(){ return <div>ok</div> }
</AD_FILE>
<AD_FILE path="components/Agendamento.jsx" op="create">
export default function Agendamento(){ return <div>agenda</div>`; // 2º truncado
    const r = parseOperationBlocks(text);
    expect(r?.ops.map((o) => o.path)).toEqual([
      "components/Servicos.jsx",
      "components/Agendamento.jsx",
    ]);
  });

  it("não duplica um arquivo já fechado", () => {
    const text = `<AD_FILE path="App.jsx" op="update">
export default function App(){ return <main/> }
</AD_FILE>`;
    const r = parseOperationBlocks(text);
    expect(r?.ops.length).toBe(1);
  });
});
