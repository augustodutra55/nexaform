import { STARTER_TEMPLATES } from "@/lib/studio";

export interface TemplateCatalogItem {
  id: string;
  name: string;
  kind: "site" | "app";
  desc: string;
  prompt: string;
  emoji: string;
  category: "business" | "sales" | "productivity" | "learning" | "game" | "portfolio";
}

function categoryFor(id: string): TemplateCatalogItem["category"] {
  if (/advogado|clinica/.test(id)) return "business";
  if (/infoproduto/.test(id)) return "sales";
  if (/dashboard|todo|calc|pomodoro/.test(id)) return "productivity";
  if (/portfolio/.test(id)) return "portfolio";
  if (/velha|ppt/.test(id)) return "game";
  return "learning";
}

export function templateCatalog(): TemplateCatalogItem[] {
  return STARTER_TEMPLATES.map((item) => ({ ...item, category: categoryFor(item.id) }));
}

export function templateById(id: string): TemplateCatalogItem | null {
  return templateCatalog().find((item) => item.id === id) || null;
}

export function remixName(name: string): string {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 100);
  return clean ? `${clean} · Remix` : "Projeto · Remix";
}

export function remixMeta(sourceProjectId?: string, templateId?: string) {
  return {
    remixedAt: new Date().toISOString(),
    ...(sourceProjectId ? { remixSourceProjectId: sourceProjectId } : {}),
    ...(templateId ? { remixTemplateId: templateId } : {}),
  };
}
