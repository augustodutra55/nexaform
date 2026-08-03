import { describe, expect, it } from "vitest";
import { buildAcceptanceReport } from "./acceptance-report";

const app = {
  kind: "app" as const,
  name: "Teste",
  description: "Aplicativo de teste",
  files: [{ path: "App.jsx", content: "export default function App(){return <h1>Teste</h1>}" }],
  entry: "App.jsx",
};

const runtime = {
  issues: [],
  stats: { buttons: 3, links: 0, forms: 0, inputs: 0, images: 0 },
  viewport: { width: 390, height: 844, overflowX: 0 },
  checkedAt: Date.now(),
};

describe("buildAcceptanceReport interaction smoke", () => {
  it("solicita o teste enquanto não existe evidência de navegação", () => {
    const report = buildAcceptanceReport({ app, runtime, previewHealth: "healthy" });
    expect(report.items.find((item) => item.id === "interaction-smoke")).toMatchObject({ status: "warning" });
  });

  it("aprova quando o runtime comprova uma mudança de tela", () => {
    const report = buildAcceptanceReport({
      app,
      previewHealth: "healthy",
      runtime: { ...runtime, smoke: { attempted: 3, changed: 2, labels: ["Início", "Clientes", "Produtos"], completedAt: Date.now() } },
    });
    expect(report.items.find((item) => item.id === "interaction-smoke")).toMatchObject({ status: "passed" });
  });

  it("mantém aviso quando controles foram clicados sem mudar a tela", () => {
    const report = buildAcceptanceReport({
      app,
      previewHealth: "healthy",
      runtime: { ...runtime, smoke: { attempted: 2, changed: 0, labels: ["Início", "Clientes"], completedAt: Date.now() } },
    });
    expect(report.items.find((item) => item.id === "interaction-smoke")).toMatchObject({ status: "warning" });
  });
});
