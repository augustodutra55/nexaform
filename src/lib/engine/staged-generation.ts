import type { PromptAttachment } from "./prompt-attachments";
import type { PreviewElementSelection, PreviewSourceCandidate } from "@/lib/preview/visual-selection";
import type { VisualRefinementBaseline } from "@/lib/preview/visual-refinement";

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
  /** Contrato leve que mantém o alvo visual verificável após uma retomada. */
  visualRefinement?: {
    selection: PreviewElementSelection;
    sourceCandidates: PreviewSourceCandidate[];
    baseline: VisualRefinementBaseline[];
  };
  nextStage: number;
  startedAt: string;
}

function isValidVisualRefinement(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object") return false;
  const refinement = value as NonNullable<StagedBuildJob["visualRefinement"]>;
  return !!refinement.selection
    && typeof refinement.selection === "object"
    && typeof refinement.selection.tag === "string"
    && typeof refinement.selection.selector === "string"
    && Array.isArray(refinement.sourceCandidates)
    && refinement.sourceCandidates.every((candidate) =>
      !!candidate
      && typeof candidate.path === "string"
      && typeof candidate.score === "number"
      && typeof candidate.evidence === "string"
    )
    && Array.isArray(refinement.baseline)
    && refinement.baseline.every((file) =>
      !!file && typeof file.path === "string" && typeof file.signature === "string"
    );
}

export function isValidStagedBuildJob(
  value: unknown,
  projectId: string,
  threadId: string
): value is StagedBuildJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Partial<StagedBuildJob>;
  const kind = job.kind ?? "initial";
  const total = stagedStages(kind).length;
  return job.version === STAGED_BUILD_VERSION
    && job.projectId === projectId
    && job.threadId === threadId
    && typeof job.originalPrompt === "string"
    && typeof job.masterPrompt === "string"
    && (kind === "initial" || kind === "refinement")
    && Number.isInteger(job.nextStage)
    && Number(job.nextStage) >= 0
    && Number(job.nextStage) < total
    && typeof job.startedAt === "string"
    && isValidVisualRefinement(job.visualRefinement);
}

/** A retomada em nuvem não guarda imagens em base64; elas podem exceder o
 * limite de uma linha e só são necessárias antes da primeira etapa. */
export function stagedJobForCloud(job: StagedBuildJob): StagedBuildJob {
  const copy = { ...job };
  delete copy.imageAttachments;
  return copy;
}

const COMPLEX_SCOPE = [
  /\b(?:tipos?|n[ií]veis?) de (?:usu[aá]rio|acesso)\b/i,
  /\b(?:painel|dashboard)(?:\s+(?:administrativo|do administrador|do consultor|gerencial|operacional|de gest[aã]o))?\b/i,
  /\b(?:banco de dados|estrutura de dados|tabelas?)\b/i,
  /\b(?:autentica[çc][aã]o|login|controle de acesso|permiss[oõ]es|lgpd)\b/i,
  /\b(?:whatsapp|e-mail|sms|push|pagamentos?|gateway|api|integra[çc][oõ]es?)\b/i,
  /\b(?:automa[çc][oõ]es?|lembretes? autom[aá]ticos?|notifica[çc][oõ]es?)\b/i,
  /\b(?:relat[oó]rios?|gr[aá]ficos?|kpis?|campanhas?|fidelidade)\b/i,
  /\b(?:hist[oó]rico|auditoria|logs? de atividade)\b/i,
  /\b(?:m[uú]ltiplas? unidades|multi.?tenant|m[uú]ltiplas? empresas)\b/i,
  /\b(?:agenda|agendamento|reagendamento|cancelamento|hor[aá]rios?)\b/i,
  /\b(?:cadastro|clientes?|tarefas?|funil|filtros?|busca|pesquisa)\b/i,
  /\b(?:estados? de (?:vazio|carregando|erro)|loading|empty state)\b/i,
  /\b(?:e-?commerce|loja|cat[aá]logo|vitrine|produtos?)\b/i,
  /\b(?:carrinho|checkout|pedidos?)\b/i,
  /\b(?:pre[çc]o|benef[ií]cios?|prova social|faq)\b/i,
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
  const specification = `${sanitizeGenerationPrompt(message)}\n${attachmentText}`;
  const bulletCount = (specification.match(/^\s*(?:[-*]|\d+[.)])\s+/gm) || []).length;
  const headingCount = (specification.match(/^\s*[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\s/()-]{5,}$/gm) || []).length;
  const scopeScore = COMPLEX_SCOPE.reduce((score, pattern) => score + (pattern.test(specification) ? 1 : 0), 0);
  const commerceWorkflow = /\b(?:e-?commerce|loja|cat[aá]logo|vitrine|produtos?)\b/i.test(specification)
    && /\b(?:carrinho|checkout|pedidos?)\b/i.test(specification);

  // Um pedido curto pode descrever um produto inteiro. Apps com vários fluxos
  // operacionais (agenda, autenticação, CRUD, dashboard, filtros, estados) não
  // devem ser forçados a caber numa única resposta apenas porque o texto é curto.
  return specification.length >= 8_000
    || bulletCount >= 45
    || commerceWorkflow
    || (specification.length >= 260 && scopeScore >= 3)
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
  const specification = `${sanitizeGenerationPrompt(message)}\n${attachmentText}`;
  const bulletCount = (specification.match(/^\s*(?:[-*]|\d+[.)])\s+/gm) || []).length;
  const headingCount = (specification.match(/^\s*[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\s/()-]{5,}$/gm) || []).length;
  const scopeScore = COMPLEX_SCOPE.reduce((score, pattern) => score + (pattern.test(specification) ? 1 : 0), 0);

  return specification.length >= 2_000
    || bulletCount >= 12
    || (specification.length >= 900 && (scopeScore >= 2 || headingCount >= 4));
}

const OPERATIONAL_ERROR_MARKER = /\bOps\s*[—-]\s*(?:Não foi possível reservar sua geração|A geração passou do tempo limite|A geração real falhou|A edição não foi aplicada)/i;

/**
 * Remove mensagens operacionais que foram copiadas acidentalmente para o
 * compositor. Em produção elas costumam vir seguidas pela repetição integral
 * da solicitação; enviar esse conteúdo de volta ao modelo aumenta custo,
 * confunde a saída e pode disparar a construção por etapas sem necessidade.
 */
export function sanitizeGenerationPrompt(input: string): string {
  const normalized = input.replace(/\r\n?/g, "\n").trim();
  const marker = normalized.search(OPERATIONAL_ERROR_MARKER);
  const withoutOperationalError = marker >= 20
    ? normalized.slice(0, marker).trim()
    : normalized;

  // Remove apenas uma duplicação grande e exata. A comparação normalizada
  // preserva requisitos legítimos repetidos em frases curtas.
  const halfway = Math.floor(withoutOperationalError.length / 2);
  for (let offset = Math.max(300, halfway - 120); offset <= halfway + 120; offset += 1) {
    const first = withoutOperationalError.slice(0, offset).trim();
    const second = withoutOperationalError.slice(offset).trim();
    if (first.length < 300 || second.length < 300) continue;
    const compactFirst = first.replace(/\s+/g, " ");
    const compactSecond = second.replace(/\s+/g, " ");
    if (compactFirst === compactSecond) return first;
  }

  return withoutOperationalError;
}

/** Incorpora anexos de texto à especificação que acompanhará todas as etapas. */
export function buildMasterPrompt(message: string, attachments: PromptAttachment[]): string {
  const textAttachments = attachments.filter((attachment) => attachment.kind === "text");
  const cleanMessage = sanitizeGenerationPrompt(message);
  if (!textAttachments.length) return cleanMessage;
  const blocks = textAttachments.map((attachment) =>
    `--- ANEXO: ${attachment.name} ---\n${attachment.content}\n--- FIM DO ANEXO ---`
  );
  // Reserva contexto para os arquivos que crescem a cada etapa e para o system
  // prompt. Especificações muito maiores continuam anexáveis, mas a orquestração
  // usa no máximo 80 mil caracteres para não estourar o contexto nos refinamentos.
  return `${cleanMessage}\n\n${blocks.join("\n\n")}`.slice(0, 80_000);
}

/** Etapas pequenas o bastante para cada resposta continuar válida e aplicável. */
export function stagedBuildStages(): StagedBuildStage[] {
  return [
    {
      id: "foundation",
      label: "Fundação e navegação",
      instruction:
        "Crie somente uma fundação mínima que abra no preview: App.jsx fino, um layout responsivo e uma única tela inicial utilizável. Não implemente autenticação, CRUD, automações, mídia, integrações nem todos os fluxos agora; isso pertence às próximas etapas. Gere no máximo 3 arquivos pequenos e mantenha cada arquivo abaixo de 120 linhas.",
    },
    {
      id: "core-data",
      label: "Cadastros e dados centrais",
      instruction:
        "Implemente somente o primeiro fluxo vertical de cadastro indispensável da especificação usando window.AD: lista, criação e edição da entidade central. Inclua validações e estados de carregamento, vazio e erro. Deixe entidades secundárias para as próximas etapas. Crie ou altere no máximo 3 arquivos curtos, abaixo de 120 linhas cada, e preserve tudo que já funciona.",
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
        "Se a especificação pedir painel administrativo ou gerencial, implemente métricas essenciais e ferramentas de operação com dados reais. Se não pedir painel, use esta etapa para implementar conteúdo comercial explicitamente solicitado e ainda ausente, como benefícios, prova social/depoimentos e FAQ, sempre em componentes realmente renderizados. Preserve os fluxos existentes e crie ou altere no máximo 3 arquivos curtos.",
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
        "Faça uma revisão final focada nos fluxos críticos: corrija imports, navegação, estados, validações, responsividade e acessibilidade. Para seções pequenas ausentes, prefira inseri-las em um componente já renderizado; só adicione um import quando criar o arquivo correspondente na mesma resposta. Não adicione módulos grandes novos. Altere apenas os arquivos indispensáveis, no máximo 5, e preserve os recursos funcionais já construídos.",
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
  const cleanMasterPrompt = sanitizeGenerationPrompt(masterPrompt);
  return [
    `${kind === "refinement" ? "REFINAMENTO" : "CONSTRUÇÃO"} POR ETAPAS — ETAPA ${index + 1} DE ${total}: ${stage.label}.`,
    stage.instruction,
    kind === "refinement"
      ? "O projeto atual já existe. Use obrigatoriamente ops, não reenvie arquivos inalterados e não recrie a aplicação."
      : index === 0
      ? "Esta é a primeira geração. Entregue uma base utilizável agora; as próximas etapas completarão o projeto. FORMATO OBRIGATÓRIO: devolva somente blocos <AD_FILE path=\"caminho.jsx\" op=\"create\">conteúdo completo</AD_FILE>, um por arquivo, seguidos opcionalmente de <AD_REPLY>resumo curto</AD_REPLY>. Não use JSON, Markdown nem cercas de código."
      : "O projeto atual já contém as etapas anteriores. Use obrigatoriamente ops e mude somente o necessário para esta etapa.",
    index === total - 1
      ? "CHECKLIST FINAL OBRIGATÓRIO: compare o projeto atual, item por item, com a ESPECIFICAÇÃO MESTRA abaixo. Implemente agora toda omissão pequena necessária para cumprir o pedido — especialmente seções de conteúdo como benefícios, prova social/depoimentos e FAQ, ações, estados e navegação. Confirme que cada recurso está importado e realmente renderizado; não considere texto do prompt como evidência. Se algo grande não couber, entregue a menor versão funcional em vez de ignorá-lo."
      : "",
    "A especificação completa é a referência do produto, mas NÃO deve ser implementada inteira nesta resposta:",
    "--- ESPECIFICAÇÃO MESTRA ---",
    cleanMasterPrompt,
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
    "Reduza drasticamente o escopo agora. Se esta for a primeira etapa, entregue apenas uma aplicação mínima executável com App.jsx, um componente de layout e uma tela inicial — no máximo 3 arquivos, sem imagens, autenticação, backend, animações ou integrações. Na primeira etapa, devolva cada arquivo completo exclusivamente em <AD_FILE path=\"caminho.jsx\" op=\"create\">...</AD_FILE>. Nas demais etapas, implemente apenas uma mudança essencial em no máximo 2 arquivos curtos. Não reenvie arquivos inalterados, não tente concluir etapas futuras e nunca use JSON ou Markdown. Para arquivos existentes, preserve o conteúdo atual e foque somente no requisito essencial desta etapa.",
  ].join("\n\n");
}
