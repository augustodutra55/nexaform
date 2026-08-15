import { describe, expect, it } from "vitest";
import { applyAcceptedFiles, applyDiff, applyFileOperations, parseOperationBlocks } from "./operation-blocks";

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

describe("applyDiff — diff de linhas (Fase 3)", () => {
  it("marca linha alterada como remoção seguida de adição", () => {
    const diff = applyDiff(
      "linha 1\nlinha 2\nlinha 3",
      "linha 1\nlinha 2 alterada\nlinha 3"
    );
    expect(diff.changed).toBe(true);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.lines.map((l) => l.kind)).toEqual(["same", "del", "add", "same"]);
    const del = diff.lines.find((l) => l.kind === "del");
    const add = diff.lines.find((l) => l.kind === "add");
    expect(del).toMatchObject({ oldLine: 2, text: "linha 2" });
    expect(add).toMatchObject({ newLine: 2, text: "linha 2 alterada" });
  });

  it("reporta arquivo idêntico como sem mudança", () => {
    const diff = applyDiff("a\nb\nc", "a\nb\nc");
    expect(diff.changed).toBe(false);
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
    expect(diff.lines.every((l) => l.kind === "same")).toBe(true);
  });

  it("conta somente adições quando linhas novas entram no fim", () => {
    const diff = applyDiff("a\nb", "a\nb\nc\nd");
    expect(diff.added).toBe(2);
    expect(diff.removed).toBe(0);
    expect(diff.lines.filter((l) => l.kind === "add").map((l) => l.text)).toEqual(["c", "d"]);
  });
});

describe("applyAcceptedFiles — aplicação de mudanças aceitas (Fase 3)", () => {
  const original = [
    { path: "App.jsx", content: "export default function App(){ return <main /> }" },
    { path: "components/Card.jsx", content: "export default function Card(){ return <div/> }" },
  ];

  it("substitui somente o arquivo aceito e preserva o resto", () => {
    const next = applyAcceptedFiles(original, [
      { path: "components/Card.jsx", content: "export default function Card(){ return <section/> }" },
    ]);
    expect(next).toEqual([
      original[0],
      { path: "components/Card.jsx", content: "export default function Card(){ return <section/> }" },
    ]);
  });

  it("remove o arquivo quando o conteúdo aceito é nulo", () => {
    const next = applyAcceptedFiles(original, [{ path: "components/Card.jsx", content: null }]);
    expect(next).toEqual([original[0]]);
  });

  it("devolve null quando nenhuma mudança altera a versão", () => {
    expect(applyAcceptedFiles(original, [{ path: "App.jsx", content: original[0].content }])).toBeNull();
  });

  it("ignora caminhos inseguros com ..", () => {
    expect(applyAcceptedFiles(original, [{ path: "../secret.js", content: "x" }])).toBeNull();
  });
});
