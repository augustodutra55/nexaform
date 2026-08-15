import { describe, expect, it } from "vitest";
import { applyFileOperations } from "./operation-blocks";

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
});
