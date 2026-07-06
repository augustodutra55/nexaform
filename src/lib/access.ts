/**
 * Controle de acesso central do AD Studio.
 *
 * Regra: usuários com role `owner` (ou cujo email bate com OWNER_EMAIL /
 * NEXT_PUBLIC_OWNER_EMAIL) têm acesso total a todos os recursos de Pro e
 * Team, sem pagamento e sem limites. Usuários normais seguem Free/Pro/Team.
 *
 * Este módulo é a ÚNICA fonte de verdade para gates de plano — cliente e
 * servidor importam daqui. Compatível com billing futuro (Stripe): o billing
 * só altera `subscriptions.plan`; a role `owner` vive em `profiles.role` e
 * nunca é tocada por webhooks de pagamento.
 */
import { Plan, PLANS, getPlan } from "./plans";

export interface AccessProfile {
  role?: string | null;   // profiles.role: 'user' | 'owner'
  email?: string | null;  // auth.users.email (fallback por env)
  plan?: string | null;   // subscriptions.plan: 'free' | 'pro' | 'team'
}

function ownerEmails(): string[] {
  const raw = process.env.OWNER_EMAIL ?? process.env.NEXT_PUBLIC_OWNER_EMAIL ?? "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** true se a conta é do dono (por role no banco OU por email de env). */
export function isOwner(p: AccessProfile): boolean {
  if (p.role === "owner") return true;
  const email = p.email?.toLowerCase();
  return !!email && ownerEmails().includes(email);
}

/** Plano virtual do owner: tudo liberado, nenhum limite. */
export const OWNER_PLAN: Plan = {
  ...PLANS.team,
  name: "Owner",
  price: "—",
  priceNote: "acesso total",
  tagline: "Conta do dono — todos os recursos de Pro e Team, sem limites.",
  maxProjects: -1,
  maxGenerationsPerMonth: Number.MAX_SAFE_INTEGER,
  canExport: true,
  canPublish: true,
  collaboration: true,
  highlighted: false,
  features: ["Acesso total a Pro e Team", "Projetos e gerações ilimitados", "Sem gates de assinatura"],
};

/** Plano efetivo: owner ignora subscriptions e usage_limits. */
export function resolvePlan(p: AccessProfile): Plan {
  return isOwner(p) ? OWNER_PLAN : getPlan(p.plan);
}

/** true se a conta tem recursos pagos (Pro/Team) — owner sempre tem. */
export function hasPaidAccess(p: AccessProfile): boolean {
  return isOwner(p) || getPlan(p.plan).id !== "free";
}

/** Formata limites para UI (∞ para owner/ilimitado). */
export function formatLimit(n: number): string {
  return n === -1 || n >= Number.MAX_SAFE_INTEGER ? "∞" : String(n);
}
