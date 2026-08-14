import { describe, expect, it } from "vitest";
import { compactProviderSystemPrompt, modelOutputTokenBudget, openRouterControlsForModel, providerSystemPrompt, qualityRepairBaseFiles, qualityRepairInstruction, shouldTryFreeModelsAfterPaidDiagnostics } from "./code-providers";
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
