import { describe, expect, it } from "vitest";
import { compactProviderSystemPrompt, modelOutputTokenBudget, openRouterControlsForModel, providerSystemPrompt, qualityRepairBaseFiles, qualityRepairInstruction, recoverStagedMissingImports, rollbackMissingImportFiles, shouldTryFreeModelsAfterPaidDiagnostics, stagedRuntimeQualityReport, streamAppWithOpenRouter, streamOpenRouter } from "./code-providers";
import { BUDGET_MODEL_OPENROUTER, PREMIUM_MODEL_OPENROUTER } from "./models";
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

  it("preserva o snapshot anterior válido quando a revisão final cria import sem arquivo", () => {
    const previous = [
      { path: "App.jsx", content: 'import Dashboard from "./Dashboard"; export default function App(){ return <Dashboard /> }' },
      { path: "Dashboard.jsx", content: 'export default function Dashboard(){ return <main><h1>KPIs de clientes e funil</h1><button onClick={()=>window.AD.select("clients", {})}>Tarefas e filtros</button></main> }' },
    ];
    const candidate = {
      provider: "openrouter",
      engineMode: "real",
      stats: { lines: 3, components: 2, hooks: 0, handlers: 0, files: 2 },
      reply: "feito",
      plan: [],
      app: {
        kind: "app",
        name: "Dashboard",
        description: "",
        files: [
          { path: "App.jsx", content: 'import Dashboard from "./Dashboard"; import Polish from "./Polish"; export default function App(){ return <><Dashboard/><Polish/></> }' },
          previous[1],
        ],
        entry: "App.jsx",
      },
      cost: 0,
      model: "teste",
    } as AppGenerationResult;
    const message = `CONSTRUÇÃO POR ETAPAS — ETAPA 7 DE 7: Revisão e acabamento.
--- ESPECIFICAÇÃO MESTRA ---
Crie um dashboard B2B com KPIs, clientes, funil, tarefas e filtros.
--- FIM DA ESPECIFICAÇÃO MESTRA ---`;

    expect(recoverStagedMissingImports(candidate, { message, currentFiles: previous, currentCode: null, name: "Dashboard" })?.app.files).toEqual(previous);
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

  it("dá teto suficiente ao Sonnet nas etapas para não truncar (Etapa 2/7)", () => {
    // Regressão do travamento da Esmalteria: 3.000 tokens cortavam a resposta.
    expect(modelOutputTokenBudget("REFINAMENTO POR ETAPAS — ETAPA 2 DE 7", true, "anthropic/claude-sonnet-4.5")).toBe(8000);
    expect(modelOutputTokenBudget("CONSTRUÇÃO POR ETAPAS — ETAPA 1 DE 7", false, "anthropic/claude-sonnet-4.5")).toBe(10000);
    // Refinamento avulso (não-etapado) permanece enxuto.
    expect(modelOutputTokenBudget("Mude a cor do botão", true, "anthropic/claude-sonnet-4.5")).toBe(4000);
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

  it("não troca por modelo mais fraco depois de uma resposta simples falhar no quality gate", () => {
    expect(shouldTryFreeModelsAfterPaidDiagnostics(false, [
      "OpenRouter: anthropic/claude-sonnet-4.5 não passou no quality gate após uma correção automática.",
    ])).toBe(false);
  });
});

// ── Streaming SSE com fallback (Fase 1) ──────────────────────────────────────

function sseChunk(delta: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`;
}

function sseUsage(promptTokens: number, completionTokens: number, cost?: number): string {
  return `data: ${JSON.stringify({
    choices: [{ delta: {} }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, ...(cost !== undefined ? { cost } : {}) },
  })}\n\n`;
}

function sseResponse(parts: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const VALID_INITIAL_PROJECT = [
  '<AD_FILE path="App.jsx" op="create">',
  'import Home from "./components/Home";',
  "export default function App() {",
  "  return <Home />;",
  "}",
  "</AD_FILE>",
  '<AD_FILE path="components/Home.jsx" op="create">',
  "export default function Home() {",
  '  return <main className="p-4">Contador pronto</main>;',
  "}",
  "</AD_FILE>",
  "<AD_REPLY>Base criada.</AD_REPLY>",
].join("\n");

const STREAM_ARGS = {
  message: "Crie um app de contador simples",
  currentFiles: null,
  currentCode: null,
  name: "Contador",
  userKey: "sk-or-teste",
  userProvider: "openrouter" as const,
  costMode: "premium" as const,
  forceReal: true,
};

describe("streamOpenRouter", () => {
  it("emite cada delta em onToken e devolve o texto completo com custo real", async () => {
    const tokens: string[] = [];
    const diag: string[] = [];
    const fetchImpl = (async () =>
      sseResponse([sseChunk("Olá "), sseChunk("mundo"), sseUsage(100, 20, 0.0042)])) as unknown as typeof fetch;

    const result = await streamOpenRouter("sk-or-teste", STREAM_ARGS, PREMIUM_MODEL_OPENROUTER, diag, {
      onToken: (token) => tokens.push(token),
      fetchImpl,
    });

    expect(result?.text).toBe("Olá mundo");
    expect(result?.cost).toBe(0.0042);
    expect(tokens).toEqual(["Olá ", "mundo"]);
    expect(diag).toEqual([]);
  });

  it("registra diagnóstico legível e devolve null em falha HTTP", async () => {
    const diag: string[] = [];
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { message: "Insufficient credits" } }), { status: 402 })) as unknown as typeof fetch;

    const result = await streamOpenRouter("sk-or-teste", STREAM_ARGS, PREMIUM_MODEL_OPENROUTER, diag, { fetchImpl });

    expect(result).toBeNull();
    expect(diag[0]).toContain("HTTP 402");
    expect(diag[0]).toContain("sem crédito/saldo");
  });
});

describe("streamAppWithOpenRouter — chain de fallback", () => {
  it("aceita o tier principal quando ele responde um projeto válido", async () => {
    const models: string[] = [];
    const fetchImpl = (async (_url: any, init: any) => {
      models.push(JSON.parse(init.body).model);
      return sseResponse([sseChunk(VALID_INITIAL_PROJECT), sseUsage(500, 300)]);
    }) as unknown as typeof fetch;

    const result = await streamAppWithOpenRouter("sk-or-teste", STREAM_ARGS, { fetchImpl });

    expect(models).toEqual([PREMIUM_MODEL_OPENROUTER]);
    expect(result.engineMode).toBe("real");
    expect(result.provider).toBe("openrouter");
    expect(result.app.files?.map((file) => file.path)).toEqual(["App.jsx", "components/Home.jsx"]);
  });

  it("cai para o próximo modelo do chain quando o principal falha por HTTP", async () => {
    const models: string[] = [];
    const attempts: Array<{ model: string; attempt: number }> = [];
    const fetchImpl = (async (_url: any, init: any) => {
      const model = JSON.parse(init.body).model;
      models.push(model);
      if (model === PREMIUM_MODEL_OPENROUTER) {
        return new Response(JSON.stringify({ error: { message: "Insufficient credits" } }), { status: 402 });
      }
      return sseResponse([sseChunk(VALID_INITIAL_PROJECT), sseUsage(500, 300)]);
    }) as unknown as typeof fetch;

    const result = await streamAppWithOpenRouter("sk-or-teste", STREAM_ARGS, {
      fetchImpl,
      onModel: (model, attempt) => attempts.push({ model, attempt }),
    });

    expect(models).toEqual([PREMIUM_MODEL_OPENROUTER, BUDGET_MODEL_OPENROUTER]);
    expect(attempts[0]).toEqual({ model: PREMIUM_MODEL_OPENROUTER, attempt: 1 });
    expect(attempts[1]).toEqual({ model: BUDGET_MODEL_OPENROUTER, attempt: 2 });
    expect(result.engineMode).toBe("real");
    expect(result.model).toBe(BUDGET_MODEL_OPENROUTER);
  });

  it("devolve o fallback-card com o motivo real quando todos os modelos falham", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { message: "Insufficient credits" } }), { status: 402 })) as unknown as typeof fetch;
    const diag: string[] = [];

    const result = await streamAppWithOpenRouter("sk-or-teste", STREAM_ARGS, { fetchImpl, diag });

    expect(result.engineMode).toBe("demo");
    expect(result.failureReason).toContain("HTTP 402");
    expect(diag.length).toBeGreaterThan(0);
  });
});
