/**
 * Component tree do Nexaform.
 *
 * Em vez de gerar código a cada prompt, a IA gera/edita um schema JSON
 * (AppSchema). O preview é renderizado a partir dele e refinamentos são
 * mutações incrementais — mais rápido, barato e versionável.
 */

export type SectionType =
  | "navbar"
  | "hero"
  | "features"
  | "stats"
  | "testimonials"
  | "pricing"
  | "faq"
  | "cta"
  | "footer"
  | "gallery"
  | "form"
  | "kpis"
  | "table"
  | "chart"
  | "content";

export interface Section {
  id: string;
  type: SectionType;
  /** Props livres, interpretadas pelo SectionRenderer. */
  props: Record<string, any>;
}

export interface PageNode {
  id: string;
  name: string;
  path: string; // ex.: "/", "/precos"
  sections: Section[];
}

export interface ThemeConfig {
  mode: "dark" | "light";
  /** Cor primária em hex. */
  primary: string;
  /** Raio de borda em px. */
  radius: number;
  font: "sans" | "serif" | "mono";
}

export interface AppSchema {
  name: string;
  description: string;
  theme: ThemeConfig;
  pages: PageNode[];
}

export interface GenerationResult {
  /** Resposta conversacional exibida no chat. */
  reply: string;
  /** Plano de construção em passos, exibido como progresso. */
  plan: string[];
  schema: AppSchema;
  provider: "local" | "claude" | "openrouter";
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const DEFAULT_THEME: ThemeConfig = {
  mode: "dark",
  primary: "#fd7c11",
  radius: 12,
  font: "sans",
};

/** Validação defensiva mínima de um schema vindo de LLM ou do banco. */
export function isValidSchema(value: any): value is AppSchema {
  return (
    value &&
    typeof value.name === "string" &&
    Array.isArray(value.pages) &&
    value.pages.every(
      (p: any) =>
        typeof p.id === "string" &&
        typeof p.path === "string" &&
        Array.isArray(p.sections)
    ) &&
    value.theme &&
    typeof value.theme.primary === "string"
  );
}
