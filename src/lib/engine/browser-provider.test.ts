import { describe, expect, it } from "vitest";
import { browserAiProvider, saveBrowserAiProvider } from "./browser-provider";

function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    values,
  };
}

describe("browserAiProvider", () => {
  it("migra o local legado para OpenRouter automático", () => {
    const storage = memory({ "nexaform:ai-provider": "local" });
    expect(browserAiProvider(storage)).toBe("openrouter");
    expect(storage.values.get("nexaform:ai-provider:v2")).toBe("openrouter");
  });

  it("mantém o local quando foi escolhido explicitamente", () => {
    const storage = memory();
    saveBrowserAiProvider(storage, "local");
    expect(browserAiProvider(storage)).toBe("local");
  });

  it("continua em OpenRouter quando o navegador bloqueia o storage", () => {
    const blocked = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(browserAiProvider(blocked)).toBe("openrouter");
    expect(() => saveBrowserAiProvider(blocked, "local")).not.toThrow();
  });
});
