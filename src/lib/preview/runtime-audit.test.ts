import { describe, expect, it } from "vitest";
import { runtimeAuditSource } from "./runtime-audit";

describe("runtimeAuditSource interaction evidence", () => {
  it("recognizes screen, URL and meaningful scroll changes", () => {
    const source = runtimeAuditSource();

    expect(source).toContain("next.screen!==previous.screen");
    expect(source).toContain("next.url!==previous.url");
    expect(source).toContain("Math.abs(next.scroll-previous.scroll)>16");
  });

  it("não abre autenticação no smoke e reprova modal que bloqueia a página", () => {
    const source = runtimeAuditSource();

    expect(source).toContain("blocking_auth_overlay");
    expect(source).toContain("clipped_auth_dialog");
    expect(source).toMatch(/entrar\|login\|acessar\|cadastro\|cadastrar\|conta/);
  });
});
