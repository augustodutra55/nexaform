export type PlanId = "free" | "pro" | "team";

export interface Plan {
  id: PlanId;
  name: string;
  price: string;
  priceNote: string;
  tagline: string;
  maxProjects: number; // -1 = ilimitado
  maxGenerationsPerMonth: number;
  canExport: boolean;
  canPublish: boolean;
  collaboration: boolean;
  features: string[];
  highlighted?: boolean;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    price: "R$ 0",
    priceNote: "para sempre",
    tagline: "Para experimentar e tirar ideias do papel.",
    maxProjects: 3,
    maxGenerationsPerMonth: 30,
    canExport: false,
    canPublish: true,
    collaboration: false,
    features: [
      "3 projetos",
      "30 gerações por mês",
      "Preview em tempo real",
      "Publicação com link compartilhável",
      "Histórico de 5 versões por projeto",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    price: "R$ 79",
    priceNote: "/mês",
    tagline: "Para quem constrói e lança com frequência.",
    maxProjects: -1,
    maxGenerationsPerMonth: 500,
    canExport: true,
    canPublish: true,
    collaboration: false,
    highlighted: true,
    features: [
      "Projetos ilimitados",
      "500 gerações por mês",
      "Exportação do projeto (JSON + código)",
      "Histórico de versões ilimitado",
      "Provedores de IA premium",
      "Suporte prioritário",
    ],
  },
  team: {
    id: "team",
    name: "Team",
    price: "R$ 249",
    priceNote: "/mês · até 10 pessoas",
    tagline: "Para times que criam juntos.",
    maxProjects: -1,
    maxGenerationsPerMonth: 3000,
    canExport: true,
    canPublish: true,
    collaboration: true,
    features: [
      "Tudo do Pro",
      "3.000 gerações por mês compartilhadas",
      "Colaboração em tempo real",
      "Papéis e permissões (admin, editor, viewer)",
      "Workspace compartilhado",
      "SSO (em breve)",
    ],
  },
};

export function getPlan(id: string | null | undefined): Plan {
  return PLANS[(id as PlanId) ?? "free"] ?? PLANS.free;
}
