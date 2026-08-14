import { describe, expect, it } from "vitest";
import { providerSystemPrompt, qualityRepairInstruction } from "./code-providers";
import type { ProjectQualityReport } from "./app-types";

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
    expect(instruction).toContain("App.jsx: Import relativo ausente");
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
