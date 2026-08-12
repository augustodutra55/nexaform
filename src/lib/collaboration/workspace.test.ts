import { describe, expect, it } from "vitest";
import { canWorkspace, normalizeInviteEmail, normalizeMemberRole, normalizeWorkspaceName } from "./workspace";

describe("workspace collaboration", () => {
  it("aplica permissões por papel", () => {
    expect(canWorkspace("owner", "manage_members")).toBe(true);
    expect(canWorkspace("admin", "manage_members")).toBe(true);
    expect(canWorkspace("editor", "edit_project")).toBe(true);
    expect(canWorkspace("editor", "manage_members")).toBe(false);
    expect(canWorkspace("viewer", "view_project")).toBe(true);
    expect(canWorkspace("viewer", "edit_project")).toBe(false);
  });

  it("normaliza nome e e-mail", () => {
    expect(normalizeWorkspaceName("  Minha   Agência  ")).toBe("Minha Agência");
    expect(normalizeInviteEmail(" CLIENTE@EXAMPLE.COM ")).toBe("cliente@example.com");
    expect(() => normalizeInviteEmail("invalido")).toThrow();
  });

  it("não permite criar owner como papel de membro", () => {
    expect(normalizeMemberRole("admin")).toBe("admin");
    expect(() => normalizeMemberRole("owner")).toThrow();
  });
});
