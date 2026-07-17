import type { AppCode, GenerationPlan, ProjectQualityReport } from "./app-types";
import { isMultiFile } from "./app-types";
import type { RuntimeAuditReport } from "@/lib/preview/runtime-audit";

export type AcceptanceStatus = "passed" | "warning" | "blocked" | "pending";

export interface AcceptanceItem {
  id: string;
  label: string;
  detail: string;
  status: AcceptanceStatus;
}

export interface AcceptanceReport {
  status: "ready" | "review" | "blocked" | "checking";
  score: number;
  items: AcceptanceItem[];
  blockers: number;
  warnings: number;
}

interface AcceptanceInput {
  app: AppCode | null;
  plan?: GenerationPlan;
  structural?: ProjectQualityReport;
  runtime?: RuntimeAuditReport;
  previewHealth: "checking" | "healthy" | "error";
}

function projectSource(app: AppCode | null): string {
  if (!app) return "";
  if (isMultiFile(app)) return app.files.map((file) => file.content).join("\n");
  return app.code || "";
}

function capabilityEvidence(capability: string, source: string): boolean {
  const normalized = capability.toLowerCase();
  if (normalized.indexOf("autentica") >= 0 || normalized.indexOf("sessão") >= 0) {
    return /window\.AD\s*\.\s*auth|\bAD\s*\.\s*auth|login|logout|signIn|signUp/i.test(source);
  }
  if (normalized.indexOf("formul") >= 0) {
    return /<form\b|onSubmit\s*=|type=["']submit["']/i.test(source);
  }
  if (normalized.indexOf("dados reais") >= 0) {
    return /window\.AD\s*\.\s*(data|list|get|create|update|remove)|\bAD\s*\.\s*(data|list|get|create|update|remove)/i.test(source);
  }
  if (normalized.indexOf("comercial") >= 0 || normalized.indexOf("pagamento") >= 0) {
    return /cta|comprar|assinar|plano|preço|preco|orçamento|orcamento|checkout/i.test(source);
  }
  if (normalized.indexOf("voz") >= 0) {
    return /window\.AD\s*\.\s*voice|\bAD\s*\.\s*voice|speechSynthesis|SpeechRecognition/i.test(source);
  }
  if (normalized.indexOf("vídeo") >= 0 || normalized.indexOf("video") >= 0) {
    return /<video\b|videoUrl|\.mp4\b|\.webm\b/i.test(source);
  }
  if (normalized.indexOf("navegação") >= 0 || normalized.indexOf("fluxo principal") >= 0) {
    return /onClick\s*=|onSubmit\s*=|set[A-Z][A-Za-z0-9_]*\s*\(/.test(source);
  }
  return true;
}

export function buildAcceptanceReport(input: AcceptanceInput): AcceptanceReport {
  const { app, plan, structural, runtime, previewHealth } = input;
  const source = projectSource(app);
  const items: AcceptanceItem[] = [];

  if (!app) {
    items.push({ id: "app", label: "Aplicativo gerado", detail: "Gere a primeira versão para iniciar o aceite.", status: "pending" });
  } else {
    items.push({
      id: "architecture",
      label: "Arquitetura editável",
      detail: isMultiFile(app)
        ? `${app.files.length} arquivos com entrada em ${app.entry}.`
        : "Projeto legado em um único arquivo; funciona, mas refinamentos podem ser mais lentos.",
      status: isMultiFile(app) ? "passed" : "warning",
    });
  }

  if (structural) {
    items.push({
      id: "structural",
      label: "Validação estrutural",
      detail: structural.valid
        ? `Código aprovado pelo motor com nota ${structural.score}/100${structural.repaired ? " após reparo automático" : ""}.`
        : structural.errors.slice(0, 3).map((issue) => issue.message).join(" ") || "O código não passou na validação estrutural.",
      status: structural.valid ? (structural.warnings.length ? "warning" : "passed") : "blocked",
    });
    for (let index = 0; index < Math.min(structural.warnings.length, 5); index++) {
      const warning = structural.warnings[index];
      items.push({
        id: `structural-warning-${index}`,
        label: "Aviso estrutural",
        detail: `${warning.path ? `${warning.path}: ` : ""}${warning.message}`,
        status: "warning",
      });
    }
  } else if (app) {
    items.push({
      id: "structural",
      label: "Validação estrutural",
      detail: "Esta versão é anterior ao Centro de Qualidade ou foi editada manualmente.",
      status: "warning",
    });
  }

  if (previewHealth === "checking") {
    items.push({ id: "runtime", label: "Preview funcional", detail: "Executando a verificação em desktop e mobile.", status: "pending" });
  } else if (runtime) {
    const errors = runtime.issues.filter((issue) => issue.severity === "error");
    const warnings = runtime.issues.filter((issue) => issue.severity === "warning");
    items.push({
      id: "runtime",
      label: "Auditoria do preview",
      detail: errors.length || warnings.length
        ? `Desktop e mobile foram auditados: ${errors.length} falha(s) e ${warnings.length} aviso(s).`
        : "Desktop e mobile executaram sem erros ou avisos detectáveis.",
      status: "passed",
    });
    const detailedIssues = runtime.issues.filter((issue) => issue.code !== "mobile_overflow").slice(0, 8);
    for (let index = 0; index < detailedIssues.length; index++) {
      const issue = detailedIssues[index];
      items.push({
        id: `runtime-issue-${index}`,
        label: issue.severity === "error" ? "Falha detectada no preview" : "Aviso detectado no preview",
        detail: issue.message,
        status: issue.severity === "error" ? "blocked" : "warning",
      });
    }
    const overflow = runtime.issues.some((issue) => issue.code === "mobile_overflow");
    items.push({
      id: "mobile",
      label: "Responsividade mobile",
      detail: overflow ? "O conteúdo ultrapassa a largura de 390 px." : "Tela verificada automaticamente em 390 px.",
      status: overflow ? "blocked" : "passed",
    });
  } else if (previewHealth === "error") {
    items.push({ id: "runtime", label: "Preview funcional", detail: "Há uma falha real de execução ou responsividade a corrigir.", status: "blocked" });
  } else if (app) {
    items.push({ id: "runtime", label: "Preview funcional", detail: "Recarregue o preview para registrar a auditoria completa.", status: "warning" });
  }

  if (plan) {
    for (let index = 0; index < plan.requiredCapabilities.length; index++) {
      const capability = plan.requiredCapabilities[index];
      const present = capabilityEvidence(capability, source);
      items.push({
        id: `capability-${index}`,
        label: capability,
        detail: present
          ? "Há evidência correspondente no código aprovado."
          : "Não encontrei evidência suficiente no código; confirme este fluxo manualmente.",
        status: present ? "passed" : "warning",
      });
    }
  }

  const blockers = items.filter((item) => item.status === "blocked").length;
  const warnings = items.filter((item) => item.status === "warning").length;
  const pending = items.filter((item) => item.status === "pending").length;
  const measured = items.filter((item) => item.status !== "pending");
  const points = measured.reduce((total, item) => total + (item.status === "passed" ? 100 : item.status === "warning" ? 65 : 0), 0);
  const score = measured.length ? Math.round(points / measured.length) : 0;
  const status = blockers ? "blocked" : pending ? "checking" : warnings ? "review" : "ready";
  return { status, score, items, blockers, warnings };
}
