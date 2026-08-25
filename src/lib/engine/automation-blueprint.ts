import type { AppCode, AppFile } from "./app-types";

export interface AppAutomationBlueprint {
  name: string;
  collection: string;
  dueField: string;
  leadMinutes: number;
  channel: "email";
  recipientField: string;
  subject: string;
  message: string;
}

const NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/;
const FIELD_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,79}$/;

function filesOf(app: AppCode): AppFile[] {
  return app.files?.length ? app.files : [{ path: "App.jsx", content: app.code || "" }];
}

export function buildAutomationBlueprint(app: AppCode): { automations: AppAutomationBlueprint[]; warnings: string[] } {
  let rawItems: unknown[] = [];
  for (const file of filesOf(app)) {
    for (const line of file.content.split(/\r?\n/)) {
      const marker = line.indexOf("AD_BACKEND:");
      if (marker < 0) continue;
      try {
        const parsed = JSON.parse(line.slice(marker + "AD_BACKEND:".length).trim().replace(/\*\/\s*$/, "").trim());
        if (Array.isArray(parsed?.automations)) rawItems = parsed.automations;
      } catch {
        return { automations: [], warnings: ["O manifesto de automações não contém JSON válido."] };
      }
      break;
    }
  }
  const automations: AppAutomationBlueprint[] = [];
  const warnings: string[] = [];
  for (const raw of rawItems.slice(0, 20)) {
    const item = raw as Record<string, unknown>;
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    const collection = typeof item?.collection === "string" ? item.collection.trim() : "";
    const dueField = typeof item?.dueField === "string" ? item.dueField.trim() : "";
    const recipientField = typeof item?.recipientField === "string" ? item.recipientField.trim() : "";
    const leadMinutes = Number(item?.leadMinutes);
    const subject = typeof item?.subject === "string" ? item.subject.trim().slice(0, 160) : "";
    const message = typeof item?.message === "string" ? item.message.trim().slice(0, 2000) : "";
    if (!NAME_RE.test(name) || !NAME_RE.test(collection) || !FIELD_RE.test(dueField) ||
        !FIELD_RE.test(recipientField) || !Number.isInteger(leadMinutes) || leadMinutes < 0 ||
        leadMinutes > 525600 || !subject || !message || item?.channel !== "email") {
      warnings.push(`Automação inválida ignorada: ${name || "sem nome"}.`);
      continue;
    }
    automations.push({ name, collection, dueField, leadMinutes, channel: "email", recipientField, subject, message });
  }
  return { automations, warnings };
}

export function automationWindow(now: Date, leadMinutes: number, intervalMinutes = 5) {
  const start = new Date(now.getTime() + leadMinutes * 60_000);
  return { start: start.toISOString(), end: new Date(start.getTime() + intervalMinutes * 60_000).toISOString() };
}
