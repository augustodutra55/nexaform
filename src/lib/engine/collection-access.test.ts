import { describe, expect, it } from "vitest";
import {
  decideCollectionAccess,
  PRIVATE_PERMISSIONS,
  type CollectionPermissions,
} from "./collection-access";

function permissions(overrides: Partial<CollectionPermissions>): CollectionPermissions {
  return { ...PRIVATE_PERMISSIONS, owner_only: false, ...overrides };
}

describe("autorização de coleções", () => {
  it("mantém coleção privada inacessível fora do painel do dono", () => {
    const result = decideCollectionAccess(PRIVATE_PERMISSIONS, "read", {
      id: "user-1",
      role: "gerente",
    });
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(403);
  });

  it("permite formulário público sem liberar leitura pública", () => {
    const policy = permissions({ public_insert: true });
    expect(decideCollectionAccess(policy, "insert", null).allowed).toBe(true);
    expect(decideCollectionAccess(policy, "read", null).allowed).toBe(false);
  });

  it("isola registros do usuário no escopo own", () => {
    const policy = permissions({
      authenticated_read: true,
      authenticated_update: true,
      authenticated_scope: "own",
    });
    const result = decideCollectionAccess(policy, "update", { id: "user-1", role: "cliente" });
    expect(result.allowed).toBe(true);
    expect(result.scopeToAppUser).toBe(true);
    expect(result.appUserId).toBe("user-1");
  });

  it("libera visão global somente ao papel permitido", () => {
    const policy = permissions({
      authenticated_read: true,
      authenticated_scope: "all",
      allowed_roles: ["gerente", "consultor"],
    });
    expect(
      decideCollectionAccess(policy, "read", { id: "g-1", role: "gerente" })
    ).toMatchObject({ allowed: true, scopeToAppUser: false });
    expect(
      decideCollectionAccess(policy, "read", { id: "c-1", role: "cliente" })
    ).toMatchObject({ allowed: false, error: "Seu perfil não tem acesso a esta coleção." });
  });

  it("prefere a política autenticada para impedir vazamento entre usuários", () => {
    const policy = permissions({
      public_read: true,
      authenticated_read: true,
      authenticated_scope: "own",
    });
    expect(
      decideCollectionAccess(policy, "read", { id: "user-1", role: "user" }).scopeToAppUser
    ).toBe(true);
  });
});
