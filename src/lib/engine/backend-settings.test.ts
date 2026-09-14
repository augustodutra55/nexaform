import { describe, expect, it } from "vitest";
import type { BackendCollectionBlueprint } from "./backend-blueprint";
import { settingsForCollection } from "./backend-settings";
import { EMPTY_DATA_CONTRACT } from "./data-contract";

function form(allowedRoles: string[]): BackendCollectionBlueprint {
  return { collection: "agendamentos", profile: "form", allowedRoles, authenticatedScope: "all", dataContract: EMPTY_DATA_CONTRACT, operations: ["read", "insert", "update", "delete"], source: "manifest", confidence: "high", reason: "teste" };
}

describe("settingsForCollection", () => {
  it("mantém formulário comum sem leitura pública ou autenticada", () => {
    const settings = settingsForCollection(form([]));
    expect(settings).toMatchObject({ public_insert: true, public_read: false, authenticated_read: false });
  });

  it("permite à equipe operar agenda híbrida sem expor pacientes ao público", () => {
    const settings = settingsForCollection(form(["admin", "equipe"]));
    expect(settings).toMatchObject({ public_insert: true, public_read: false, authenticated_read: true, authenticated_update: true, authenticated_delete: true, authenticated_scope: "all" });
  });
});
