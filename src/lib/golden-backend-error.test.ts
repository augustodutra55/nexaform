import { describe, expect, it } from "vitest";
import { formatGoldenBackendError } from "./golden-backend-error";

describe("formatGoldenBackendError", () => {
  it("preserva erros textuais do backend", () => {
    expect(formatGoldenBackendError({ error: "Manifesto inválido" }, 400)).toBe("Manifesto inválido");
  });

  it("extrai a mensagem de erros estruturados", () => {
    expect(formatGoldenBackendError({ error: { message: "Acesso negado", code: "auth" } }, 401)).toBe("Acesso negado");
  });

  it("serializa objetos em vez de emitir [object Object]", () => {
    expect(formatGoldenBackendError({ error: { code: "protected_deployment" } }, 401)).toBe('{"code":"protected_deployment"}');
  });

  it("inclui o status quando a resposta não traz erro", () => {
    expect(formatGoldenBackendError({}, 502)).toBe("Backend Golden não foi provisionado (HTTP 502).");
  });
});
