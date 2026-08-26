import type { AppCode, AppFile } from "./app-types";

export interface AppBackendAction {
  name: string;
  target: string;
}

export interface BackendActionBlueprint {
  actions: AppBackendAction[];
  warnings: string[];
}

const NAME_RE = /^[a-z][a-z0-9_-]{0,59}$/;

function filesOf(app: AppCode): AppFile[] {
  return Array.isArray(app.files) && app.files.length ? app.files : [{ path: "App.jsx", content: app.code || "" }];
}

function safeTarget(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Extrai ações HTTP declarativas; execução continua limitada pelo cofre do projeto. */
export function buildBackendActionBlueprint(app: AppCode): BackendActionBlueprint {
  const warnings: string[] = [];
  const actions = new Map<string, AppBackendAction>();
  for (const file of filesOf(app)) {
    for (const line of file.content.split(/\r?\n/)) {
      const marker = line.indexOf("AD_BACKEND:");
      if (marker < 0) continue;
      try {
        const parsed = JSON.parse(line.slice(marker + "AD_BACKEND:".length).trim().replace(/\*\/\s*$/, "").trim());
        if (!Array.isArray(parsed?.actions)) continue;
        for (const raw of parsed.actions.slice(0, 20)) {
          const name = typeof raw?.name === "string" ? raw.name.trim() : "";
          const target = safeTarget(raw?.target);
          if (!NAME_RE.test(name) || !target) {
            warnings.push("Uma ação de backend inválida foi ignorada.");
            continue;
          }
          if (actions.has(name)) {
            warnings.push(`Ação duplicada ignorada: ${name}.`);
            continue;
          }
          actions.set(name, { name, target });
        }
      } catch {
        // Um manifesto malformado não ganha capacidade de executar funções.
      }
    }
  }
  return { actions: Array.from(actions.values()), warnings };
}
