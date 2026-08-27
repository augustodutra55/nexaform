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
      runtime: { ...runtime, smoke: { attempted: 3, changed: 2, labels: ["Início", "Clientes", "Produtos"], fieldsAttempted: 2, fieldsEditable: 2, fieldLabels: ["Nome", "E-mail"], completedAt: Date.now() } },
    });
    expect(report.items.find((item) => item.id === "interaction-smoke")).toMatchObject({ status: "passed" });
  });

  it("mantém aviso quando controles foram clicados sem mudar a tela", () => {
    const report = buildAcceptanceReport({
      app,
      previewHealth: "healthy",
      runtime: { ...runtime, smoke: { attempted: 2, changed: 0, labels: ["Início", "Clientes"], fieldsAttempted: 1, fieldsEditable: 1, fieldLabels: ["Busca"], completedAt: Date.now() } },
    });
    expect(report.items.find((item) => item.id === "interaction-smoke")).toMatchObject({ status: "warning" });
  });

  it("não confunde campos editáveis com fluxo funcional", () => {
    const report = buildAcceptanceReport({
      app,
      previewHealth: "healthy",
      runtime: { ...runtime, smoke: { attempted: 0, changed: 0, labels: [], fieldsAttempted: 2, fieldsEditable: 2, fieldLabels: ["E-mail", "Senha"], completedAt: Date.now() } },
    });
    expect(report.items.find((item) => item.id === "interaction-smoke")).toMatchObject({ status: "warning" });
  });

  it("bloqueia publicação quando dados autenticados não possuem entrada", () => {
    const broken = {
      ...app,
      files: [{
        path: "App.jsx",
        content: '// AD_BACKEND: {"collections":[{"name":"patients","access":"authenticated"}]}\nexport default function App(){ AD.auth.me(); return <h1>Pacientes</h1> }',
      }],
    };
    const report = buildAcceptanceReport({ app: broken, runtime, previewHealth: "healthy" });

    expect(report.items.find((item) => item.id === "backend-access")).toMatchObject({ status: "blocked" });
    expect(report.blockers).toBeGreaterThan(0);
  });
});
