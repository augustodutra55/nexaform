import { describe, expect, it } from "vitest";
import { environmentProviderOrder } from "./provider-order";

describe("environmentProviderOrder", () => {
  it("usa OpenRouter como padrão automático", () => {
    expect(environmentProviderOrder(null)).toEqual(["openrouter", "claude"]);
    expect(environmentProviderOrder("openrouter")).toEqual(["openrouter", "claude"]);
  });

  it("respeita Claude explícito e desliga provedores no template local", () => {
    expect(environmentProviderOrder("claude")).toEqual(["claude", "openrouter"]);
    expect(environmentProviderOrder("local")).toEqual([]);
  });
});
