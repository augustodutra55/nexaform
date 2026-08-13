import crypto from "node:crypto";
import fs from "node:fs";

const baseUrl = String(process.env.PRODUCTION_URL || "https://nexaform-rho.vercel.app").replace(/\/$/, "");
const projectId = String(process.env.AD_GOLDEN_PROJECT_ID || "").trim();
const serviceSecret = String(process.env.AD_GOLDEN_SERVICE_SECRET || "").trim();

if (!projectId) throw new Error("AD_GOLDEN_PROJECT_ID não configurado.");
if (!serviceSecret) throw new Error("AD_GOLDEN_SERVICE_SECRET não configurado.");

function signedHeaders() {
  const timestamp = String(Date.now());
  const signature = crypto.createHmac("sha256", serviceSecret).update(timestamp).digest("hex");
  return {
    "content-type": "application/json",
    "x-ad-golden-timestamp": timestamp,
    "x-ad-golden-signature": signature,
  };
}

async function assertAuthenticatedSession() {
  const response = await fetch(`${baseUrl}/api/golden/generate`, {
    method: "POST",
    headers: signedHeaders(),
    body: "{}",
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => null);
  if (response.status !== 400) {
    throw new Error(
      `Preflight de autenticação de serviço retornou HTTP ${response.status}: ${String(data?.error || "resposta inesperada")}`
    );
  }
  console.log("AUTH preflight PASS — autenticação de serviço reconhecida; nenhuma geração consumida.");
}

await assertAuthenticatedSession();

const cases = [
  ["landing", "Landing de serviço premium", "Crie uma landing page profissional e vendável para uma consultoria empresarial, com hero forte, benefícios, prova social, formulário de contato, FAQ e CTA recorrente. Visual premium, moderno e responsivo."],
  ["agenda", "Agenda SaaS", "Crie um app SaaS de agendamento para uma clínica: login, cadastro, agenda por dia e horário, cadastro de clientes, confirmação, reagendamento, cancelamento e estados de vazio, carregando e erro. Precisa funcionar bem no celular."],
  ["dashboard", "Dashboard operacional", "Crie um dashboard de gestão B2B para equipe comercial com KPIs, clientes, funil, tarefas, filtros e navegação responsiva. Deve ser um sistema profissional, rápido, com estados operacionais claros e sem botões decorativos."],
  ["commerce", "E-commerce orientado à conversão", "Crie um site e-commerce para produtos de cuidado pessoal, com catálogo, cards de produto, busca, benefícios, preço, carrinho demonstrativo, jornada de checkout sem simular pagamento real, prova social e FAQ. Foco máximo em conversão e confiança."],
  ["media", "Experiência com mídia", "Crie um site institucional premium para uma empresa de arquitetura e inclua uma área de vídeo responsiva com controles. Se não houver vídeo enviado, mostre o placeholder correto para mídia sem inventar URL."],
];

const rows = [];
for (const [id, name, message] of cases) {
  const started = Date.now();
  let status = 0;
  let data = null;
  let error = "";
  try {
    const response = await fetch(`${baseUrl}/api/golden/generate`, {
      method: "POST",
      headers: signedHeaders(),
      body: JSON.stringify({ projectId, message, name: `Golden ${name}` }),
      signal: AbortSignal.timeout(290_000),
    });
    status = response.status;
    data = await response.json().catch(() => null);
    if (!response.ok) error = String(data?.error || `HTTP ${response.status}`);
  } catch (reason) {
    error = reason instanceof Error ? reason.message : String(reason);
  }
  const durationMs = Date.now() - started;
  const app = data?.app;
  const hasCode = !!app && ((Array.isArray(app.files) && app.files.length > 0) || (typeof app.code === "string" && app.code.trim().length > 0));
  const passed = status >= 200 && status < 300 && data?.engineMode === "real" && hasCode;
  rows.push({ id, name, passed, status, durationMs, provider: data?.provider || null, model: data?.model || null, error: error || null });
  console.log(`${passed ? "PASS" : "FAIL"} ${id} HTTP ${status || "-"} ${(durationMs / 1000).toFixed(1)}s${error ? ` — ${error}` : ""}`);
}

const passed = rows.filter((row) => row.passed).length;
const successRate = Math.round((passed / rows.length) * 1000) / 10;
const report = { productionUrl: baseUrl, generatedAt: new Date().toISOString(), total: rows.length, passed, successRate, targetSuccessRate: 90, rows };
fs.mkdirSync("artifacts", { recursive: true });
fs.writeFileSync("artifacts/golden-production.json", JSON.stringify(report, null, 2));
console.log(`Golden suite: ${passed}/${rows.length} = ${successRate}% (meta >= 90%)`);
if (successRate < 90) process.exitCode = 1;
