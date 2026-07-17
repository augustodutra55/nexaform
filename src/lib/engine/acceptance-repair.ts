import type { GenerationPlan, ProjectQualityReport } from "./app-types";
import type { RuntimeAuditReport } from "@/lib/preview/runtime-audit";

interface AcceptanceRepairInput {
  runtime?: RuntimeAuditReport;
  structural?: ProjectQualityReport;
  plan?: GenerationPlan;
  fallbackError?: string;
  attempt: number;
  maxAttempts: number;
}

function clean(value: string | null | undefined, max = 280): string {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Identificador estável para não disparar o mesmo reparo duas vezes no mesmo preview. */
export function acceptanceRepairFingerprint(input: Pick<AcceptanceRepairInput, "runtime" | "structural" | "fallbackError">): string {
  const structural = (input.structural?.errors || [])
    .map((issue) => `${issue.code}:${issue.path || ""}:${clean(issue.message, 120)}`)
    .sort();
  const runtime = (input.runtime?.issues || [])
    .filter((issue) => issue.severity === "error")
    .map((issue) => `${issue.code}:${issue.selector || ""}:${clean(issue.message, 120)}`)
    .sort();
  return structural.concat(runtime, clean(input.fallbackError, 160)).filter(Boolean).join("|").slice(0, 1200);
}

/**
 * Converte evidências determinísticas em uma instrução cirúrgica para o motor.
 * O código atual segue no payload da geração; aqui enviamos somente o diagnóstico.
 */
export function buildAcceptanceRepairPrompt(input: AcceptanceRepairInput): string {
  const failures: string[] = [];
  for (const issue of (input.structural?.errors || []).slice(0, 6)) {
    failures.push(`- [estrutura:${issue.code}] ${issue.path ? `${issue.path}: ` : ""}${clean(issue.message)}`);
  }
  for (const issue of (input.runtime?.issues || []).filter((item) => item.severity === "error").slice(0, 8)) {
    failures.push(`- [preview:${issue.code}] ${issue.selector ? `${issue.selector}: ` : ""}${clean(issue.message)}`);
  }
  if (!failures.length && input.fallbackError) failures.push(`- [execução] ${clean(input.fallbackError, 500)}`);

  const objective = clean(input.plan?.objective, 240);
  const criteria = (input.plan?.acceptanceCriteria || []).slice(0, 6).map((item) => `- ${clean(item, 220)}`);

  return [
    `⚙️ REPARO CONTROLADO DO CENTRO DE QUALIDADE — tentativa ${input.attempt}/${input.maxAttempts}.`,
    objective ? `Objetivo original que deve ser preservado: ${objective}` : "Preserve integralmente o objetivo e o visual atuais.",
    "Falhas comprovadas pela auditoria:",
    failures.join("\n") || "- O preview falhou antes de produzir detalhes adicionais.",
    criteria.length ? `Critérios do contrato que continuam obrigatórios:\n${criteria.join("\n")}` : "",
    "Corrija apenas a causa das falhas acima nos menores arquivos possíveis.",
    "Não recrie o projeto inteiro, não remova funcionalidades, não troque a identidade visual e não altere áreas não relacionadas.",
    "Para arquivo existente, devolva somente AD_PATCH com AD_SEARCH literal e único + AD_REPLACE. Use AD_FILE apenas para criar arquivo realmente necessário.",
    "Garanta imports válidos, valores nulos protegidos, navegação por estado React, responsividade em 390 px e botões/formulários com ações reais.",
    "Não explique a solução fora do formato de edição: entregue somente as operações necessárias.",
  ].filter(Boolean).join("\n\n");
}
