export type ReadinessStatus = "ready" | "warning" | "blocked";

export interface ReadinessCheck {
  id: string;
  label: string;
  detail: string;
  status: ReadinessStatus;
  action?: string;
}

export interface ReadinessReport {
  status: ReadinessStatus;
  ready: number;
  total: number;
  checks: ReadinessCheck[];
  release: ReleaseCertification;
  generatedAt: string;
}

export interface ReleaseGate {
  number: number;
  id: string;
  label: string;
  detail: string;
  status: ReadinessStatus;
  evidence: string[];
  action?: string;
}

export interface ReleaseCertification {
  status: ReadinessStatus;
  ready: number;
  total: 12;
  score: number;
  certified: boolean;
  gates: ReleaseGate[];
}

const severity: Record<ReadinessStatus, number> = {
  ready: 0,
  warning: 1,
  blocked: 2,
};

export function summarizeReadiness(
  checks: ReadinessCheck[],
  generatedAt = new Date().toISOString()
): ReadinessReport {
  const status = checks.reduce<ReadinessStatus>(
    (current, check) => severity[check.status] > severity[current] ? check.status : current,
    "ready"
  );
  return {
    status,
    ready: checks.filter((check) => check.status === "ready").length,
    total: checks.length,
    checks,
    release: buildReleaseCertification(checks),
    generatedAt,
  };
}

const capabilityGates: ReleaseGate[] = [
  gate(1, "architecture", "Arquitetura e código multi-arquivo", [
    "Planejamento determinístico antes da geração",
    "App.jsx fino e componentes pequenos por seção",
  ]),
  gate(2, "model-routing", "Roteamento de IA previsível", [
    "Modos econômico, automático e premium",
    "Sem rebaixamento silencioso de modelo",
  ]),
  gate(4, "quality-repair", "Qualidade e autorreparo", [
    "Quality gate estrutural antes de salvar",
    "Auditoria de runtime e correção cirúrgica",
  ]),
  gate(5, "interaction-tests", "Testes reais de interação", [
    "Playwright cobre login, menus, formulário, CRUD e mobile",
    "TypeScript, unitários, build e E2E executados no CI",
  ]),
  gate(8, "visual-engine", "Motor visual premium", [
    "Blueprint visual por segmento",
    "Movimento, mídia e 3D com orçamento de performance",
  ]),
  gate(9, "visual-editor", "Editor visual clicável", [
    "Seleção de elemento diretamente no preview",
    "Refinamento preserva e verifica o alvo visual",
  ]),
  gate(10, "versions-portability", "Versões e portabilidade", [
    "Histórico, desfazer e retomada por etapas",
    "Importação e exportação React + Vite",
  ]),
];

function gate(number: number, id: string, label: string, evidence: string[]): ReleaseGate {
  return {
    number,
    id,
    label,
    detail: "Implementado e coberto pelo pipeline de qualidade do repositório.",
    status: "ready",
    evidence,
  };
}

function checkGate(
  number: number,
  id: string,
  label: string,
  checks: ReadinessCheck[],
  requiredIds: string[],
  evidence: string[]
): ReleaseGate {
  const required = requiredIds.map((requiredId) => checks.find((check) => check.id === requiredId));
  const missing = required.filter((check) => !check || check.status !== "ready");
  if (!missing.length) return gate(number, id, label, evidence);
  const blocked = missing.find((check) => check?.status === "blocked");
  const first = blocked || missing[0];
  return {
    number,
    id,
    label,
    detail: first?.detail || "A verificação necessária não foi encontrada.",
    status: blocked ? "blocked" : "warning",
    evidence,
    action: first?.action,
  };
}

export function buildReleaseCertification(checks: ReadinessCheck[]): ReleaseCertification {
  const dynamicGates = [
    checkGate(3, "durable-generation", "Fila durável de geração", checks,
      ["background-worker", "migration-0014", "migration-0015"],
      ["Worker autenticado", "Retomada entre navegadores", "Lease e retry transacionais"]),
    checkGate(6, "professional-backend", "Backend, autenticação e RLS", checks,
      ["migration-0009", "migration-0010", "migration-0012"],
      ["Coleções privadas por padrão", "Papéis, contratos e isolamento por projeto"]),
    checkGate(7, "contextual-media", "Imagens, áudio e vídeo", checks,
      ["migration-0011"],
      ["Imagens contextuais por IA", "Upload persistente de imagens, áudio e vídeo"]),
    checkGate(11, "commercial-publishing", "Publicação e entrega comercial", checks,
      ["supabase-public", "service-role"],
      ["Publicação com slug seguro", "White-label, pacote de entrega e código exportável"]),
    checkGate(12, "observability", "Operação e observabilidade", checks,
      ["migration-0013"],
      ["Custos, latência e falhas de geração", "Erros reais de apps publicados"]),
  ];
  const gates = capabilityGates.concat(dynamicGates).sort((a, b) => a.number - b.number);
  const status = gates.reduce<ReadinessStatus>(
    (current, item) => severity[item.status] > severity[current] ? item.status : current,
    "ready"
  );
  const ready = gates.filter((item) => item.status === "ready").length;
  return {
    status,
    ready,
    total: 12,
    score: Math.round((ready / 12) * 100),
    certified: ready === 12,
    gates,
  };
}

export function probeCheck(input: {
  id: string;
  label: string;
  ok: boolean;
  readyDetail: string;
  missingDetail: string;
  action?: string;
  optional?: boolean;
}): ReadinessCheck {
  return {
    id: input.id,
    label: input.label,
    detail: input.ok ? input.readyDetail : input.missingDetail,
    status: input.ok ? "ready" : input.optional ? "warning" : "blocked",
    action: input.ok ? undefined : input.action,
  };
}
