import { describe, expect, it } from "vitest";
import { shouldBypassSupabase } from "./middleware";

describe("shouldBypassSupabase", () => {
  it("libera somente o harness e o preview reservado durante E2E", () => {
    expect(shouldBypassSupabase("/e2e-runtime/preview", "1")).toBe(true);
    expect(shouldBypassSupabase("/preview/e2e/e2e", "1")).toBe(true);
    expect(shouldBypassSupabase("/preview/projeto-real/versao", "1")).toBe(false);
    expect(shouldBypassSupabase("/dashboard", "1")).toBe(false);
  });

  it("não cria bypass fora do modo E2E", () => {
    expect(shouldBypassSupabase("/e2e-runtime/preview", undefined)).toBe(false);
    expect(shouldBypassSupabase("/preview/e2e/e2e", "0")).toBe(false);
  });
});
