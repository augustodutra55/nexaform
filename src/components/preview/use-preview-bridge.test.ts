import { describe, expect, it } from "vitest";
import { bridgeErrorMessage } from "./use-preview-bridge";

describe("bridgeErrorMessage", () => {
  it("não exibe [object Object] para erros estruturados", () => {
    expect(bridgeErrorMessage({ error: { message: "Preview protegido" } }, 401))
      .toBe("Preview protegido");
    expect(bridgeErrorMessage({ error: { code: "unauthorized" } }, 401))
      .toBe("Erro 401");
  });
});
