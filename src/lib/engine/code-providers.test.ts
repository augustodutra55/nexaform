import { describe, expect, it } from "vitest";
import { compactProviderSystemPrompt, modelOutputTokenBudget, openRouterControlsForModel, providerSystemPrompt, qualityRepairBaseFiles, qualityRepairInstruction, rollbackMissingImportFiles, shouldTryFreeModelsAfterPaidDiagnostics, stagedRuntimeQualityReport } from "./code-providers";
import type { AppGenerationResult, ProjectQualityReport } from "./app-types";

const report: ProjectQualityReport = {
  valid: false,
  score: 80,
  repaired: false,
  errors: [{
    code: "missing_import",
    message: "Import relativo ausente.",
    path: "App.jsx",
  }],
  warnings: [],
};

describe("reparo dirigido do quality gate", () => {
  it("mantém AD_FILE na fundação vazia da construção por etapas", () => {
    const instruction = qualityRepairInstruction({
      message: "CONSTRUÇÃO POR ETAPAS — ETAPA 1/7",
      currentFiles: null,
      currentCode: null,
    }, report);
    expect(instruction).toContain("AD_FILE");
    expect(instruction).toContain("AD_REPLY");
    expect(instruction).toContain("Não use JSON");
  });

  it("usa patches curtos quando o projeto já existe", () => {
    const instruction = qualityRepairInstruction({
      message: "CONSTRUÇÃO POR ETAPAS — ETAPA 2/7",
      currentFiles: [{ path: "App.jsx", content: "export default function App(){}" }],
      currentCode: null,
    }, report);
    expect(instruction).toContain("AD_PATCH/AD_FILE/AD_DELETE");
    expect(instruction).toContain("PROJETO CANDIDATO");
    expect(instruction).not.toContain("projeto original");
    expect(instruction).toContain("App.jsx: Import relativo ausente");
  });

  it("aplica a correção sobre o candidato que contém os arquivos novos da etapa", () => {
    const previous = [{ path: "App.jsx", content: "export default function App(){}" }];
    const candidateFiles = [
      ...previous,
      { path: "components/Cadastro.jsx", content: "export default function Cadastro(){}" },
    ];
    const candidate = {
      provider: "openrouter",
      engineMode: "real",
      stats: { lines: 2, components: 2, hooks: 0, handlers: 0, files: 2 },
      reply: "feito",
      plan: [],
      app: { kind: "app", name: "Teste", description: "", files: candidateFiles, entry: "App.jsx" },
      cost: 0,
      model: "teste",
    } as AppGenerationResult;

    expect(qualityRepairBaseFiles(candidate, previous)).toBe(candidateFiles);
  });

  it("restaura somente o arquivo existente que introduziu import quebrado", () => {
    const previous = [{ path: "App.jsx", content: "export default function App(){ return <main /> }" }];
    const candidate = {
      provider: "openrouter",
      engineMode: "real",
      stats: { lines: 3, components: 2, hooks: 0, handlers: 0, files: 2 },
      reply: "feito",
      plan: [],
      app: {
        kind: "app",
        name: "Teste",
        description: "",
        files: [
          { path: "App.jsx", content: 'import Agenda from "./components/Agenda"; export default function App(){ return <Agenda /> }' },
          { path: "components/Filtro.jsx", content: "export default function Filtro(){ return <button /> }" },
        ],
        entry: "App.jsx",
      },
      cost: 0,
      model: "teste",
    } as AppGenerationResult;

    const recovered = rollbackMissingImportFiles(candidate, previous, report);
    expect(recovered?.app.files).toEqual([
      previous[0],
      candidate.app.files![1],
    ]);
  });

  it("descarta um arquivo novo quando ele próprio contém import quebrado", () => {
    const previous = [{ path: "App.jsx", content: "export default function App(){ return <main /> }" }];
    const candidate = {
      provider: "openrouter",
      engineMode: "real",
      stats: { lines: 2, components: 2, hooks: 0, handlers: 0, files: 2 },
      reply: "feito",
      plan: [],
      app: {
        kind: "app",
        name: "Teste",
        description: "",
        files: [...previous, { path: "components/Agenda.jsx", content: 'import X from "./X"; export default X' }],
        entry: "App.jsx",
      },
      cost: 0,
      model: "teste",
    } as AppGenerationResult;
    const missingInNewFile: ProjectQualityReport = {
      ...report,
      errors: [{ ...report.errors[0], path: "components/Agenda.jsx" }],
    };

    expect(rollbackMissingImportFiles(candidate, previous, missingInNewFile)?.app.files).toEqual(previous);
  });
});

describe("quality gate progressivo das etapas", () => {
  it("mantém bloqueios que quebram o runtime e rebaixa acabamento para aviso", () => {
    const staged = stagedRuntimeQualityReport({
      valid: false,
      score: 40,
      repaired: false,
      errors: [
        { code: "missing_import", message: "Import ausente", path: "App.jsx" },
        { code: "file_too_large", message: "Arquivo grande", path: "components/Cadastro.jsx" },
        { code: "dependency_budget", message: "Pacotes demais" },
      ],
      warnings: [],
    }, true);

    expect(staged.valid).toBe(false);
    expect(staged.errors.map((value) => value.code)).toEqual(["missing_import"]);
    expect(staged.warnings.map((value) => value.code)).toEqual(["file_too_large", "dependency_budget"]);
  });

  it("aprova a etapa quando restam somente alertas tratáveis depois", () => {
    const staged = stagedRuntimeQualityReport({
      valid: false,
      score: 80,
      repaired: false,
      errors: [{ code: "file_too_large", message: "Arquivo grande" }],
      warnings: [],
    }, true);
    expect(staged.valid).toBe(true);
    expect(staged.errors).toEqual([]);
    expect(staged.warnings[0].code).toBe("file_too_large");
  });

  it("bloqueia capacidades ausentes e componentes órfãos na etapa final", () => {
    const staged = stagedRuntimeQualityReport({
      valid: false,
      score: 60,
      repaired: false,
      errors: [
        { code: "orphan_component", message: "FAQ não renderizada", path: "components/FAQ.jsx" },
        { code: "missing_auth", message: "Autenticação ausente" },
        { code: "missing_commercial_flow", message: "Checkout ausente" },
        { code: "missing_required_section", message: "FAQ ausente" },
        { code: "file_too_large", message: "Arquivo grande", path: "App.jsx" },
      ],
      warnings: [],
    }, true, true);

    expect(staged.valid).toBe(false);
    expect(staged.errors.map((value) => value.code)).toEqual([
      "orphan_component",
      "missing_auth",
      "missing_commercial_flow",
      "missing_required_section",
    ]);
    expect(staged.warnings.map((value) => value.code)).toEqual(["file_too_large"]);
  });
});


describe("contrato determinístico de saída", () => {
  it("usa AD_FILE no reparo de uma primeira geração simples", () => {
    const instruction = qualityRepairInstruction({
      message: "Crie uma landing premium para consultoria",
      currentFiles: null,
      currentCode: null,
    }, report);
    expect(instruction).toContain("AD_FILE");
    expect(instruction).toContain("Não use JSON");
    expect(instruction).not.toContain("JSON files obrigatório");
  });

  it("faz AD_FILE prevalecer depois da antiga instrução JSON", () => {
    const prompt = providerSystemPrompt(false);
    const jsonInstruction = prompt.indexOf("Responda APENAS com JSON válido");
    const transportOverride = prompt.indexOf("FORMATO FINAL DE TRANSPORTE");
    expect(jsonInstruction).toBeGreaterThanOrEqual(0);
    expect(transportOverride).toBeGreaterThan(jsonInstruction);
    expect(prompt.slice(transportOverride)).toContain('<AD_FILE path="App.jsx" op="create">');
    expect(prompt.slice(transportOverride)).toContain("SUBSTITUI qualquer instrução anterior");
  });
});


describe("orçamento adaptativo por modelo", () => {
  it("não repassa 24k para o fallback barato", () => {
    expect(modelOutputTokenBudget("Crie uma landing premium", false, "xiaomi/mimo-v2.5")).toBe(7000);
    expect(modelOutputTokenBudget("CONSTRUÇÃO POR ETAPAS — ETAPA 1/7", false, "xiaomi/mimo-v2.5")).toBe(3200);
    expect(modelOutputTokenBudget("CONSTRUÇÃO POR ETAPAS — ETAPA 2/7", true, "xiaomi/mimo-v2.5")).toBe(2200);
  });

  it("mantém o orçamento amplo do Sonnet e limita a rota free", () => {
    expect(modelOutputTokenBudget("Crie uma landing premium", false, "anthropic/claude-sonnet-4.5")).toBe(24000);
    expect(modelOutputTokenBudget("Crie uma landing premium", false, "openrouter/free")).toBe(7000);
    expect(modelOutputTokenBudget("CONSTRUÇÃO POR ETAPAS — ETAPA 1/7", false, "nvidia/nemotron-3-ultra-550b-a55b:free")).toBe(3600);
    expect(modelOutputTokenBudget("CONSTRUÇÃO POR ETAPAS — ETAPA 2/7", true, "nvidia/nemotron-3-ultra-550b-a55b:free")).toBe(2600);
  });

  it("usa um contrato compacto e único nos modelos gratuitos", () => {
    const initial = compactProviderSystemPrompt(false);
    expect(initial).toContain('<AD_FILE path="App.jsx" op="create">');
    expect(initial).toContain("window.AD");
    expect(initial).toContain("ADIMG");
    expect(initial).not.toContain("Responda APENAS com JSON válido");

    const refinement = compactProviderSystemPrompt(true);
    expect(refinement).toContain("AD_PATCH");
    expect(refinement).toContain("AD_SEARCH");
  });
});


describe("controles de saída do fallback OpenRouter", () => {
  it("desliga reasoning somente no MiMo para preservar tokens do código final", () => {
    expect(openRouterControlsForModel("xiaomi/mimo-v2.5")).toEqual({
      reasoning: { enabled: false },
      temperature: 0.2,
    });
    expect(openRouterControlsForModel("anthropic/claude-sonnet-4.5")).toEqual({});
    expect(openRouterControlsForModel("openrouter/free")).toEqual({});
    expect(openRouterControlsForModel("nvidia/nemotron-3-ultra-550b-a55b:free")).toEqual({
      reasoning: { enabled: false },
      temperature: 0.2,
    });
  });
});

describe("orçamento de tempo dos fallbacks gratuitos", () => {
  it("mantém o fallback gratuito quando os pagos estão indisponíveis por HTTP", () => {
    expect(shouldTryFreeModelsAfterPaidDiagnostics(true, [
      "OpenRouter: modelo anthropic/claude-sonnet-4.5 → HTTP 402 — sem crédito/saldo.",
      "OpenRouter: modelo xiaomi/mimo-v2.5 → HTTP 402 — sem crédito/saldo.",
    ])).toBe(true);
  });

  it("interrompe a fila de fallback após timeout ou falha estrutural do modelo principal", () => {
    expect(shouldTryFreeModelsAfterPaidDiagnostics(true, [
      "OpenRouter: modelo anthropic/claude-sonnet-4.5 não respondeu dentro do limite desta etapa.",
    ])).toBe(false);
    expect(shouldTryFreeModelsAfterPaidDiagnostics(true, [
      "OpenRouter: xiaomi/mimo-v2.5 não passou no quality gate após uma correção automática.",
    ])).toBe(false);
  });

  it("não limita gerações simples", () => {
    expect(shouldTryFreeModelsAfterPaidDiagnostics(false, [
      "OpenRouter: modelo anthropic/claude-sonnet-4.5 não respondeu dentro do limite desta etapa.",
    ])).toBe(true);
  });
});
