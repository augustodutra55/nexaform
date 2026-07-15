import type { PromptAttachment } from "./prompt-attachments";

export const STAGED_BUILD_VERSION = 1;

export interface StagedBuildStage {
  id: string;
  label: string;
  instruction: string;
}

export interface StagedBuildJob {
  version: number;
  projectId: string;
  threadId: string;
  originalPrompt: string;
  masterPrompt: string;
  /** Projetos existentes usam um roteiro menor e exclusivamente cirúrgico. */
  kind?: "initial" | "refinement";
  /** Referências visuais preservadas somente enquanto a primeira etapa não concluiu. */
  imageAttachments?: PromptAttachment[];
  nextStage: number;
  startedAt: string;
}

const COMPLEX_SCOPE = [
  /\b(?:tipos?|n[ií]veis?) de (?:usu[aá]rio|acesso)\b/i,
  /\b(?:painel|dashboard) (?:administrativo|do administrador|do consultor|gerencial)\b/i,
  /\b(?:banco de dados|estrutura de dados|tabelas?)\b/i,
  /\b(?:autentica[çc][aã]o|controle de acesso|permiss[oõ]es|lgpd)\b/i,
  /\b(?:whatsapp|e-mail|sms|push|pagamentos?|gateway|api|integra[çc][oõ]es?)\b/i,
  /\b(?:automa[çc][oõ]es?|lembretes? autom[aá]ticos?|notifica[çc][oõ]es?)\b/i,
  /\b(?:relat[oó]rios?|gr[aá]ficos?|campanhas?|fidelidade)\b/i,
  /\b(?:hist[oó]rico|auditoria|logs? de atividade)\b/i,
  /\b(?:m[uú]ltiplas? unidades|multi.?tenant|m[uú]ltiplas? empresas)\b/i,
];

/** Detecta especificações que não cabem com segurança em uma única resposta. */
export function shouldStageInitialBuild(
  message: string,
  attachments: PromptAttachment[],
  hasCurrentProject: boolean
): boolean {
  if (hasCurrentProject) return false;
  const attachmentText = attachments
    .filter((attachment) => attachment.kind === "text")
    .map((attachment) => attachment.content)
    .join("\n");
  const specification = `${message}\n${attachmentText}`;
  const bulletCount = (specification.match(/^\s*(?:[-*]|\d+[.)])\s+/gm) || []).length;
  const headingCount = (specification.match(/^\s*[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\s/()-]{5,}$/gm) || []).length;
  const scopeScore = COMPLEX_SCOPE.reduce((score, pattern) => score + (pattern.test(specification) ? 1 : 0), 0);

  return specification.length >= 8_000
    || bulletCount >= 45
    || (specification.length >= 3_500 && (scopeScore >= 5 || headingCount >= 10));
}

/** Detecta refinamentos amplos que precisam ser aplicados e salvos em partes. */
export function shouldStageRefinement(
  message: string,
  attachments: PromptAttachment[],
  hasCurrentProject: boolean
): boolean {
  if (!hasCurrentProject) return false;
  const attachmentText = attachments
    .filter((attachment) => attachment.kind === "text")
    .map((attachment) => attachment.content)
    .join("\n");
  const specification = `${message}\n${attachmentText}`;
  const bulletCount = (specification.match(/^\s*(?:[-*]|\d+[.)])\s+/gm) || []).length;
  const headingCount = (specification.match(/^\s*[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\s/()-]{5,}$/gm) || []).length;
  const scopeScore = COMPLEX_SCOPE.reduce((score, pattern) => score + (pattern.test(specification) ? 1 : 0), 0);

  return specification.length >= 2_000
    || bulletCount >= 12
    || (specification.length >= 900 && (scopeScore >= 2 || headingCount >= 4));
}

/** Incorpora anexos de texto à especificação que acompanhará todas as etapas. */
export function buildMasterPrompt(message: string, attachments: PromptAttachment[]): string {
  const textAttachments = attachments.filter((attachment) => attachment.kind === "text");
  if (!textAttachments.length) return message.trim();
  const blocks = textAttachments.map((attachment) =>
    `--- ANEXO: ${attachment.name} ---\n${attachment.content}\n--- FIM DO ANEXO ---`
  );
  // Reserva contexto para os arquivos que crescem a cada etapa e para o system
  // prompt. Especificações muito maiores continuam anexáveis, mas a orquestração
  // usa no máximo 80 mil caracteres para não estourar o contexto nos refinamentos.
  return `${message.trim()}\n\n${blocks.join("\n\n")}`.slice(0, 80_000);
}

/** Etapas pequenas o bastante para cada resposta continuar válida e aplicável. */
export function stagedBuildStages(): StagedBuildStage[] {
  return [
    {
      id: "foundation",
      label: "Fundação e navegação",
      instruction:
        "Crie a fundação funcional e navegável do produto. Implemente o sistema visual, App.jsx fino, navegação responsiva, autenticação via AD.auth se solicitada, dados de demonstração e somente os 3 a 5 fluxos mais importantes. Gere no máximo 10 arquivos pequenos. Não tente concluir toda a especificação nesta etapa.",
    },
    {
      id: "core-data",
      label: "Cadastros e dados centrais",
      instruction:
        "Implemente os cadastros, entidades e relacionamentos centrais da especificação usando window.AD. Priorize CRUD funcional, validações, carregamento, vazio e erro. Crie ou altere no máximo 5 arquivos curtos e preserve tudo que já funciona.",
    },
    {
      id: "core-workflows",
      label: "Fluxos operacionais",
      instruction:
        "Implemente os principais fluxos operacionais ainda ausentes: formulários, status, histórico, agenda, aprovações ou equivalentes descritos na especificação. Faça integrações internas reais com window.AD. Crie ou altere no máximo 5 arquivos curtos.",
    },
    {
      id: "roles-admin",
      label: "Perfis e acessos",
      instruction:
        "Implemente somente autenticação, perfis e permissões de interface pedidos. Cada usuário final deve ver apenas as áreas coerentes com seu perfil. Não simule segurança de servidor: use AD.auth e window.AD e deixe explícito no código o que depende da configuração das coleções. Crie ou altere no máximo 3 arquivos curtos.",
    },
    {
      id: "admin",
      label: "Painel administrativo",
      instruction:
        "Implemente o painel administrativo ou gerencial, métricas essenciais e ferramentas de operação solicitadas. Use dados reais das coleções já existentes e preserve os fluxos dos demais perfis. Crie ou altere no máximo 3 arquivos curtos.",
    },
    {
      id: "automation",
      label: "Alertas e regras de negócio",
      instruction:
        "Implemente notificações internas, cálculos, lembretes e regras de negócio possíveis no runtime atual. Para WhatsApp, e-mail, SMS, pagamentos ou APIs externas, crie pontos de integração e estados de interface honestos, sem fingir que um serviço externo foi enviado. Crie ou altere no máximo 3 arquivos curtos.",
    },
    {
      id: "quality",
      label: "Revisão e acabamento",
      instruction:
        "Faça uma revisão final focada nos fluxos críticos: corrija imports, navegação, estados, validações, responsividade e acessibilidade. Não adicione módulos grandes novos. Altere apenas os arquivos indispensáveis, no máximo 5, e preserve os recursos funcionais já construídos.",
    },
  ];
}

/** Refinamentos usam poucas etapas e no máximo dois arquivos por resposta. */
export function stagedRefinementStages(): StagedBuildStage[] {
  return [
    {
      id: "refine-structure",
      label: "Estrutura e navegação",
      instruction:
        "Implemente somente a estrutura, navegação, perfis e telas indispensáveis pedidos na especificação. Preserve o visual, os dados e tudo que já funciona. Use obrigatoriamente ops e altere no máximo 2 arquivos curtos; não reescreva o projeto.",
    },
    {
      id: "refine-behavior",
      label: "Fluxos e dados",
      instruction:
        "Implemente somente os comportamentos, estados, formulários e dados centrais ainda ausentes na especificação. Integre com a estrutura existente e window.AD quando aplicável. Use obrigatoriamente ops e altere no máximo 2 arquivos curtos.",
    },
    {
      id: "refine-quality",
      label: "Integração e revisão",
      instruction:
        "Revise exclusivamente a integração do refinamento: imports, navegação, estados, responsividade, textos e ações críticas. Corrija o indispensável sem criar módulos grandes. Use obrigatoriamente ops e altere no máximo 2 arquivos curtos.",
    },
  ];
}

export function stagedStages(kind: "initial" | "refinement" = "initial"): StagedBuildStage[] {
  return kind === "refinement" ? stagedRefinementStages() : stagedBuildStages();
}

export function buildStagePrompt(
  masterPrompt: string,
  stage: StagedBuildStage,
  index: number,
  total: number,
  kind: "initial" | "refinement" = "initial"
): string {
  return [
    `${kind === "refinement" ? "REFINAMENTO" : "CONSTRUÇÃO"} POR ETAPAS — ETAPA ${index + 1} DE ${total}: ${stage.label}.`,
    stage.instruction,
    kind === "refinement"
      ? "O projeto atual já existe. Use obrigatoriamente ops, não reenvie arquivos inalterados e não recrie a aplicação."
      : index === 0
      ? "Esta é a primeira geração. Entregue uma base utilizável agora; as próximas etapas completarão o projeto."
      : "O projeto atual já contém as etapas anteriores. Use obrigatoriamente ops e mude somente o necessário para esta etapa.",
    "A especificação completa é a referência do produto, mas NÃO deve ser implementada inteira nesta resposta:",
    "--- ESPECIFICAÇÃO MESTRA ---",
    masterPrompt,
    "--- FIM DA ESPECIFICAÇÃO MESTRA ---",
  ].join("\n\n");
}

/** Segunda tentativa deliberadamente menor quando uma etapa não conclui. */
export function buildStageRetryPrompt(
  masterPrompt: string,
  stage: StagedBuildStage,
  index: number,
  total: number,
  kind: "initial" | "refinement" = "initial"
): string {
  return [
    buildStagePrompt(masterPrompt, stage, index, total, kind),
    "RECUPERAÇÃO AUTOMÁTICA: a tentativa anterior desta etapa não concluiu.",
    "Reduza o escopo agora: implemente somente a parte mais importante desta etapa e altere/crie no máximo 2 arquivos curtos. Não reenvie arquivos inalterados, não reescreva o projeto e não tente compensar recursos de etapas futuras. Entregue blocos AD_FILE pequenos e válidos, nunca JSON.",
  ].join("\n\n");
}
