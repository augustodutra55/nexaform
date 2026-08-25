import { describe, expect, it } from "vitest";
import { decryptProjectIntegration, encryptProjectIntegration, validateProjectIntegration } from "./project-secrets";

const env = { PROJECT_SECRETS_KEY: "test-master-key-with-at-least-32-characters" } as unknown as NodeJS.ProcessEnv;

describe("project integration vault", () => {
  it("cifra e autentica o segredo por projeto e provedor", () => {
    const config = { provider: "stripe" as const, secretKey: "sk_test_abcdefghijklmnop" };
    const encrypted = encryptProjectIntegration("project-a", config, env);
    expect(encrypted).not.toContain(config.secretKey);
    expect(decryptProjectIntegration("project-a", "stripe", encrypted, env)).toEqual(config);
    expect(() => decryptProjectIntegration("project-b", "stripe", encrypted, env)).toThrow();
  });

  it("aceita somente credenciais e endpoints seguros", () => {
    expect(validateProjectIntegration("automation", { targets: ["https://hooks.example.com/ad"] })).toEqual({
      provider: "automation", targets: ["https://hooks.example.com/ad"],
    });
    expect(() => validateProjectIntegration("automation", { targets: ["http://hooks.example.com/ad"] })).toThrow(/HTTPS/);
    expect(() => validateProjectIntegration("stripe", { secretKey: "pk_test_publica" })).toThrow(/Stripe/);
  });
});
