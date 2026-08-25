import type { AppCode, AppFile } from "./app-types";

export interface AppPaymentPriceBlueprint {
  key: string;
  priceId: string;
  mode: "payment" | "subscription";
}

export interface AppPaymentBlueprint {
  provider: "stripe";
  prices: AppPaymentPriceBlueprint[];
}

const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/;
const PRICE_RE = /^price_[A-Za-z0-9]+$/;

function filesOf(app: AppCode): AppFile[] {
  return app.files?.length ? app.files : [{ path: "App.jsx", content: app.code || "" }];
}

export function buildPaymentBlueprint(app: AppCode): { payments: AppPaymentBlueprint | null; warnings: string[] } {
  let raw: unknown = null;
  for (const file of filesOf(app)) {
    for (const line of file.content.split(/\r?\n/)) {
      const marker = line.indexOf("AD_BACKEND:");
      if (marker < 0) continue;
      try {
        const parsed = JSON.parse(line.slice(marker + "AD_BACKEND:".length).trim().replace(/\*\/\s*$/, "").trim());
        raw = parsed?.payments ?? null;
      } catch {
        return { payments: null, warnings: ["O manifesto de pagamentos não contém JSON válido."] };
      }
      break;
    }
  }
  if (!raw) return { payments: null, warnings: [] };
  const value = raw as Record<string, unknown>;
  if (value.provider !== "stripe" || !value.prices || typeof value.prices !== "object" || Array.isArray(value.prices)) {
    return { payments: null, warnings: ["Configuração de pagamentos inválida ignorada."] };
  }
  const prices: AppPaymentPriceBlueprint[] = [];
  const warnings: string[] = [];
  for (const [key, entry] of Object.entries(value.prices as Record<string, unknown>).slice(0, 40)) {
    const price = entry as Record<string, unknown>;
    const priceId = typeof price?.priceId === "string" ? price.priceId.trim() : "";
    const mode = price?.mode === "subscription" ? "subscription" : "payment";
    if (!KEY_RE.test(key) || !PRICE_RE.test(priceId)) {
      warnings.push(`Preço de pagamento inválido ignorado: ${key || "sem chave"}.`);
      continue;
    }
    prices.push({ key, priceId, mode });
  }
  if (!prices.length) warnings.push("Nenhum preço Stripe válido foi declarado.");
  return { payments: prices.length ? { provider: "stripe", prices } : null, warnings };
}
