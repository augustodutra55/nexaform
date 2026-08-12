import { describe, expect, it } from "vitest";
import {
  normalizeCustomDomain,
  snapshotFromVercelDomain,
  vercelAddProjectDomainUrl,
  vercelDomainConfigFromEnv,
  vercelProjectDomainUrl,
} from "./custom-domain";

describe("custom domain", () => {
  it("normaliza domínio simples", () => {
    expect(normalizeCustomDomain("  WWW.Exemplo.COM. ")).toBe("www.exemplo.com");
  });

  it.each([
    "https://exemplo.com",
    "exemplo.com/path",
    "*.exemplo.com",
    "user@exemplo.com",
    "localhost",
    "-exemplo.com",
  ])("rejeita entrada insegura %s", (value) => {
    expect(() => normalizeCustomDomain(value)).toThrow();
  });

  it("só habilita Vercel com token e projeto", () => {
    expect(vercelDomainConfigFromEnv({})).toBeNull();
    expect(vercelDomainConfigFromEnv({ VERCEL_TOKEN: "t", VERCEL_PROJECT_ID: "p" })).toEqual({
      token: "t",
      projectId: "p",
      teamId: undefined,
    });
  });

  it("monta endpoints com teamId sem expor token", () => {
    const config = { token: "secret", projectId: "prj 1", teamId: "team_1" };
    expect(vercelAddProjectDomainUrl(config)).toContain("/v10/projects/prj%201/domains?teamId=team_1");
    expect(vercelProjectDomainUrl(config, "app.exemplo.com", "verify")).toContain(
      "/v9/projects/prj%201/domains/app.exemplo.com/verify?teamId=team_1"
    );
    expect(vercelProjectDomainUrl(config)).not.toContain("secret");
  });

  it("expõe apenas estado necessário da Vercel", () => {
    const snapshot = snapshotFromVercelDomain(
      { name: "app.exemplo.com", verified: true, misconfigured: false, private: "ignore" },
      "fallback.com"
    );
    expect(snapshot.name).toBe("app.exemplo.com");
    expect(snapshot.verified).toBe(true);
    expect(snapshot.configured).toBe(true);
    expect((snapshot as any).private).toBeUndefined();
  });
});
