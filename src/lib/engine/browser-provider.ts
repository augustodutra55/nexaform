export type BrowserAiProvider = "openrouter" | "claude" | "local";

interface BrowserStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const LEGACY_PROVIDER_KEY = "nexaform:ai-provider";
const PROVIDER_KEY = "nexaform:ai-provider:v2";

/** Migra o antigo `local` implícito para OpenRouter. */
export function browserAiProvider(storage: BrowserStorage): BrowserAiProvider {
  try {
    const versioned = storage.getItem(PROVIDER_KEY);
    if (versioned === "claude" || versioned === "local" || versioned === "openrouter") return versioned;

    const legacy = storage.getItem(LEGACY_PROVIDER_KEY);
    const migrated = legacy === "claude" || legacy === "openrouter" ? legacy : "openrouter";
    storage.setItem(PROVIDER_KEY, migrated);
    return migrated;
  } catch {
    return "openrouter";
  }
}

export function saveBrowserAiProvider(storage: BrowserStorage, provider: BrowserAiProvider): void {
  try {
    storage.setItem(PROVIDER_KEY, provider);
  } catch {
    // Preferências podem ser bloqueadas pelo navegador; OpenRouter continua
    // sendo o padrão seguro da sessão seguinte.
  }
}
