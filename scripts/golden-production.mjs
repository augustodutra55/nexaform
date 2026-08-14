import crypto from "node:crypto";
import fs from "node:fs";
import { evaluateGoldenCandidate } from "./lib/golden-evaluator.mjs";

const baseUrl = String(process.env.PRODUCTION_URL || "https://nexaform-rho.vercel.app").replace(/\/$/, "");
const projectId = String(process.env.AD_GOLDEN_PROJECT_ID || "").trim();
const serviceSecret = String(process.env.AD_GOLDEN_SERVICE_SECRET || "").trim();
if (!projectId) throw new Error("AD_GOLDEN_PROJECT_ID não configurado.");
if (!serviceSecret) throw new Error("AD_GOLDEN_SERVICE_SECRET não configurado.");
function signedHeaders() { const timestamp = String(Date.now()); const signature = crypto.createHmac("sha256", serviceSecret).update(timestamp).digest("hex"); return { "content-type": "application/json", "x-ad-golden-timestamp": timestamp, "x-ad-golden-signature": signature }; }
async function assertAuthenticatedSession() { const response = await fetch(`${baseUrl}/api/golden/generate`, { method: "POST", headers: signedHeaders(), body: "{}", signal: AbortSignal.timeout(15_000) }); const data = await response.json().catch(() => null); if (response.status !== 400) throw new Error(`Preflight de autenticação de serviço retornou HTTP ${response.status}: ${String(data?.error || "resposta inesperada")}`); console.log("AUTH preflight PASS — autenticação de serviço reconhecida; nenhuma geração consumida."); }
await assertAuthenticatedSession();
const cases = [
  ["landing", "Landing de serviço premium", "Crie uma landing page profissional e vendável para uma consultoria empresarial, com hero forte, benefícios, prova social, formulário de contato, FAQ e CTA recorrente. Visual premium, moderno e responsivo.", false],
  ["agenda", "Agenda SaaS", "Crie um app SaaS de agendamento para uma clínica: login, cadastro, agenda por dia e horário, cadastro de clientes, confirmação, reagendamento, cancelamento e estados de vazio, carregando e erro. Precisa funcionar bem no celular.", true],
  ["dashboard", "Dashboard operacional", "Crie um dashboard de gestão B2B para equipe comercial com KPIs, clientes, funil, tarefas, filtros e navegação responsiva. Deve ser um sistema profissional, rápido, com estados operacionais claros e sem botões decorativos.", true],
  ["commerce", "E-commerce orientado à conversão", "Crie um site e-commerce para produtos de cuidado pessoal, com catálogo, cards de produto, busca, benefícios, preço, carrinho demonstrativo, jornada de checkout sem simular pagamento real, prova social e FAQ. Foco máximo em conversão e confiança.", true],
  ["media", "Experiência com mídia", "Crie um site institucional premium para uma empresa de arquitetura e inclua uma área de vídeo responsiva com controles. Se não houver vídeo enviado, mostre o placeholder correto para mídia sem inventar URL.", false],
];
function hasGeneratedCode(data) { const app = data?.app; return !!app && ((Array.isArray(app.files) && app.files.length > 0) || (typeof app.code === "string" && app.code.trim().length > 0)); }
async function requestGeneration(payload, timeoutMs) { const response = await fetch(`${baseUrl}/api/golden/generate`, { method: "POST", headers: signedHeaders(), body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) }); const data = await response.json().catch(() => null); return { response, data }; }
async function requestStageWithRecovery(id, stageIndex, payload) {
  let last = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await requestGeneration(payload, 290_000);
      last = result;
      if (result.response.ok || ![429, 502, 503, 504].includes(result.response.status) || attempt === 2) return result;
      console.log(`  STAGE RETRY ${id} ${stageIndex + 1}/7 após HTTP ${result.response.status} — uma única recuperação Golden será executada.`);
    } catch (reason) {
      if (attempt === 2) throw reason;
      const error = reason instanceof Error ? reason.message : String(reason);
      console.log(`  STAGE RETRY ${id} ${stageIndex + 1}/7 após ${error} — uma única recuperação Golden será executada.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return last;
}
async function runSimpleCase(id, name, message) {
  let last = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await requestGeneration({ projectId, message, name: `Golden ${name}` }, 290_000);
      last = result;
      if (result.response.ok || ![429, 502, 503, 504].includes(result.response.status) || attempt === 2) {
        return { status: result.response.status, data: result.data, error: result.response.ok ? "" : String(result.data?.error || `HTTP ${result.response.status}`) };
      }
      console.log(`SIMPLE RETRY ${id} após HTTP ${result.response.status} — uma única recuperação Golden será executada.`);
    } catch (reason) {
      if (attempt === 2) throw reason;
      const error = reason instanceof Error ? reason.message : String(reason);
      console.log(`SIMPLE RETRY ${id} após ${error} — uma única recuperação Golden será executada.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return { status: last?.response?.status || 0, data: last?.data || null, error: "Falha após a recuperação Golden." };
}
async function runStagedCase(id, name, message) { let currentFiles = null; let lastData = null; let lastStatus = 0; const totalStages = 7; for (let stageIndex = 0; stageIndex < totalStages; stageIndex += 1) { const stageStarted = Date.now(); try { const { response, data } = await requestStageWithRecovery(id, stageIndex, { projectId, message, name: `Golden ${name}`, currentFiles, stageIndex }); lastStatus = response.status; lastData = data; const elapsed = ((Date.now() - stageStarted) / 1000).toFixed(1); if (!response.ok || data?.engineMode !== "real" || !hasGeneratedCode(data)) { const error = String(data?.error || `HTTP ${response.status}`); console.log(`  STAGE FAIL ${id} ${stageIndex + 1}/${totalStages} HTTP ${response.status} ${elapsed}s — ${error}`); return { status: response.status, data, error: `etapa ${stageIndex + 1}/${totalStages}: ${error}` }; } currentFiles = Array.isArray(data?.app?.files) ? data.app.files : currentFiles; console.log(`  STAGE PASS ${id} ${stageIndex + 1}/${totalStages} HTTP ${response.status} ${elapsed}s${data?.stage?.label ? ` — ${data.stage.label}` : ""}${data?.stage?.snapshotRecovery ? " — snapshot recovery" : ""}`); } catch (reason) { const error = reason instanceof Error ? reason.message : String(reason); console.log(`  STAGE FAIL ${id} ${stageIndex + 1}/${totalStages} HTTP - ${((Date.now() - stageStarted) / 1000).toFixed(1)}s — ${error}`); return { status: 0, data: lastData, error: `etapa ${stageIndex + 1}/${totalStages}: ${error}` }; } } return { status: lastStatus, data: lastData, error: "" }; }
const rows = [];
const generatedApps = [];
for (const [id, name, message, staged] of cases) {
  const started = Date.now();
  let status = 0;
  let data = null;
  let error = "";
  try {
    const result = staged ? await runStagedCase(id, name, message) : await runSimpleCase(id, name, message);
    status = result.status;
    data = result.data;
    error = result.error;
  } catch (reason) {
    error = reason instanceof Error ? reason.message : String(reason);
  }
  const durationMs = Date.now() - started;
  const transportPassed = status >= 200 && status < 300 && data?.engineMode === "real" && hasGeneratedCode(data) && !error;
  const evaluation = hasGeneratedCode(data)
    ? evaluateGoldenCandidate(id, data)
    : { passed: false, score: 0, semanticRate: 0, checks: [], blockers: ["generated-code"] };
  const passed = transportPassed && evaluation.passed;
  const failedChecks = evaluation.checks.filter((item) => !item.passed).map((item) => item.id);
  rows.push({
    id,
    name,
    staged,
    passed,
    status,
    durationMs,
    provider: data?.provider || null,
    model: data?.model || null,
    evaluatorScore: evaluation.score,
    semanticRate: evaluation.semanticRate,
    failedChecks,
    error: error || (!evaluation.passed ? `Golden 2.0 recusou: ${failedChecks.join(", ") || evaluation.blockers.join(", ")}` : null),
  });
  if (hasGeneratedCode(data)) generatedApps.push({ id, name, app: data.app, evaluation });
  console.log(`${passed ? "PASS" : "FAIL"} ${id} HTTP ${status || "-"} ${(durationMs / 1000).toFixed(1)}s${staged ? " staged" : ""} EVAL ${evaluation.score}% SEM ${evaluation.semanticRate}%${error ? ` — ${error}` : failedChecks.length ? ` — ${failedChecks.join(", ")}` : ""}`);
}
const passed = rows.filter((row) => row.passed).length;
const successRate = Math.round((passed / rows.length) * 1000) / 10;
const report = { validationVersion: 2, productionUrl: baseUrl, generatedAt: new Date().toISOString(), total: rows.length, passed, successRate, targetSuccessRate: 90, rows };
fs.mkdirSync("artifacts", { recursive: true });
fs.writeFileSync("artifacts/golden-production.json", JSON.stringify(report, null, 2));
fs.writeFileSync("artifacts/golden-apps.json", JSON.stringify(generatedApps, null, 2));
console.log(`Golden 2.0 static suite: ${passed}/${rows.length} = ${successRate}% (meta >= 90%)`);
if (successRate < 90) process.exitCode = 1;
