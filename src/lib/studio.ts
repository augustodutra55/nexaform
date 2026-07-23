/**
 * Studio — metadados de produção do projeto (guardados em projects.meta jsonb).
 * Serve para qualquer tipo de projeto: site, app ou jogo.
 */

import type { ProjectMediaAsset } from "@/lib/media/project-media";
import type { GenerationPlan, ProjectQualityReport } from "@/lib/engine/app-types";
import type { RuntimeAuditReport } from "@/lib/preview/runtime-audit";

export type ProjectStatus = "rascunho" | "producao" | "revisao" | "entregue";

export type AcceptanceRepairStatus = "repairing" | "verifying" | "verified" | "failed";

/** Estado auditável do último ciclo automático de reparo. */
export interface AcceptanceRepairSnapshot {
  status: AcceptanceRepairStatus;
  attempt: number;
  maxAttempts: number;
  fingerprint: string;
  issueCodes: string[];
  startedAt: string;
  updatedAt: string;
  lastError?: string;
}

/** Evidências persistidas do último código aprovado no preview. */
export interface ProjectAcceptanceSnapshot {
  /** Pedido transformado em contrato antes da geração. */
  plan?: GenerationPlan;
  /** Validação estática executada pelo motor antes de devolver o código. */
  structural?: ProjectQualityReport;
  /** Auditoria do DOM real combinando desktop e mobile. */
  runtime?: RuntimeAuditReport;
  /** Último ciclo de reparo disparado pelas evidências do aceite. */
  repair?: AcceptanceRepairSnapshot;
  updatedAt: string;
}

export interface CommercialDeliveryMeta {
  logoUrl?: string;
  primaryColor?: string;
  contactEmail?: string;
  customDomain?: string;
  handoffNotes?: string;
  deliveredAt?: string;
}

export interface BackendProvisioningMeta {
  version: 1;
  status: "ready" | "review";
  usesAuth: boolean;
  collections: string[];
  warnings: string[];
  updatedAt: string;
}

export interface ProjectMeta {
  status?: ProjectStatus;
  notes?: string;
  /** Marca o projeto como modelo reutilizável na galeria de início. */
  template?: boolean;
  /** Cliente/rótulo do projeto (opcional). */
  client?: string;
  /** Entrega white-label: publicação sem a marca AD Studio. */
  whitelabel?: boolean;
  /** Identidade e registro do pacote entregue ao cliente. */
  delivery?: CommercialDeliveryMeta;
  /** Arquivos enviados pela Central de Mídia para reutilização no projeto. */
  media?: ProjectMediaAsset[];
  /** Contrato e evidências de qualidade da última versão aprovada. */
  acceptance?: ProjectAcceptanceSnapshot;
  /** Última configuração automática de coleções, contratos e acesso. */
  backendProvisioning?: BackendProvisioningMeta;
}

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  rascunho: "Rascunho",
  producao: "Em produção",
  revisao: "Em revisão",
  entregue: "Entregue",
};

export const STATUS_ORDER: ProjectStatus[] = ["rascunho", "producao", "revisao", "entregue"];

/** Cor do badge por status (classes utilitárias). */
export const STATUS_STYLE: Record<ProjectStatus, string> = {
  rascunho: "bg-secondary text-secondary-foreground",
  producao: "bg-amber-500/15 text-amber-500",
  revisao: "bg-brand-500/15 text-brand-400",
  entregue: "bg-emerald-500/15 text-emerald-500",
};

export function readMeta(value: any): ProjectMeta {
  return value && typeof value === "object" ? (value as ProjectMeta) : {};
}

/* ── Galeria de modelos de início (universal: sites, apps, jogos) ── */

export interface StarterTemplate {
  id: string;
  name: string;
  kind: "site" | "app";
  desc: string;
  /** prompt usado para gerar a primeira versão a partir do modelo. */
  prompt: string;
  emoji: string;
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  // Sites / comercial
  { id: "landing-clinica", name: "Landing · Clínica", kind: "site", emoji: "🦷", desc: "Página de captação para clínica/consultório.", prompt: "Crie uma landing page profissional para uma clínica, com hero, serviços, depoimentos, planos, FAQ e formulário de agendamento." },
  { id: "landing-advogado", name: "Site · Advogado", kind: "site", emoji: "⚖️", desc: "Site institucional para advogado/escritório.", prompt: "Crie um site institucional para um escritório de advocacia, com áreas de atuação, sobre, depoimentos, contato e CTA de consulta." },
  { id: "landing-infoproduto", name: "Página de vendas", kind: "site", emoji: "🚀", desc: "Página de vendas de infoproduto/curso.", prompt: "Crie uma página de vendas de infoproduto, com headline forte, benefícios, prova social, oferta, FAQ e CTA de compra." },
  { id: "dashboard-admin", name: "Dashboard admin", kind: "site", emoji: "📊", desc: "Painel administrativo com KPIs e tabela.", prompt: "Crie um dashboard administrativo com KPIs, gráfico de receita e tabela de últimas transações." },
  { id: "portfolio", name: "Portfólio", kind: "site", emoji: "🎨", desc: "Portfólio profissional com galeria.", prompt: "Monte um portfólio profissional com galeria de trabalhos, sobre e formulário de contato." },
  // Apps / ferramentas
  { id: "todo", name: "Lista de tarefas", kind: "app", emoji: "✅", desc: "App de tarefas com prioridades.", prompt: "Crie um app de lista de tarefas com adicionar, concluir, remover e filtrar por status." },
  { id: "calc", name: "Calculadora", kind: "app", emoji: "🧮", desc: "Calculadora funcional.", prompt: "Crie uma calculadora funcional com as operações básicas." },
  { id: "pomodoro", name: "Pomodoro", kind: "app", emoji: "⏱️", desc: "Timer de foco com presets.", prompt: "Crie um timer Pomodoro com iniciar, pausar, zerar e presets de tempo." },
  // Jogos
  { id: "velha", name: "Jogo da velha", kind: "app", emoji: "❌", desc: "Jogo da velha para dois jogadores.", prompt: "Crie um jogo da velha para dois jogadores, com detecção de vitória e empate e botão de reiniciar." },
  { id: "ppt", name: "Pedra, papel, tesoura", kind: "app", emoji: "✂️", desc: "Contra o computador, com placar.", prompt: "Crie um jogo de pedra, papel e tesoura contra o computador, com placar e animações." },
];
