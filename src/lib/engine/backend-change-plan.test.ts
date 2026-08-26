import { describe, expect, it } from "vitest";
import { buildBackendChangePlan } from "./backend-change-plan";
import type { BackendCollectionBlueprint } from "./backend-blueprint";

function collection(name: string, fields: string[] = [], profile: BackendCollectionBlueprint["profile"] = "private"): BackendCollectionBlueprint {
  return {
    collection: name,
    profile,
    allowedRoles: [],
    authenticatedScope: "own",
    dataContract: { version: 1, allowUnknown: false, fields: Object.fromEntries(fields.map((field) => [field, { type: "string" }])) },
    operations: [],
    source: "manifest",
    confidence: "high",
    reason: "teste",
  };
}

describe("backend change plan", () => {
  it("identifica criação aditiva como segura", () => {
    const plan = buildBackendChangePlan({ collections: [collection("clientes", ["nome"])], actions: [] }, { collections: [collection("clientes", ["nome", "email"]), collection("agenda")], actions: [] });
    expect(plan.addedCollections).toEqual(["agenda"]);
    expect(plan.changedCollections[0].addedFields).toEqual(["email"]);
    expect(plan.destructive).toBe(false);
  });

  it("marca remoção de coleção ou campo como destrutiva", () => {
    const plan = buildBackendChangePlan(
      { collections: [collection("clientes", ["nome", "cpf"]), collection("agenda")], actions: [] },
      { collections: [collection("clientes", ["nome"])], actions: [] }
    );
    expect(plan.removedCollections).toEqual(["agenda"]);
    expect(plan.changedCollections[0].removedFields).toEqual(["cpf"]);
    expect(plan.destructive).toBe(true);
  });

  it("detecta mudança de perfil de acesso", () => {
    const plan = buildBackendChangePlan({ collections: [collection("produtos")], actions: [] }, { collections: [collection("produtos", [], "catalog")], actions: [] });
    expect(plan.changedCollections[0].accessChanged).toBe(true);
    expect(plan.destructive).toBe(false);
  });

  it("inclui ações declarativas no plano", () => {
    const plan = buildBackendChangePlan(
      { collections: [], actions: [{ name: "antiga", target: "https://a.example.com" }] },
      { collections: [], actions: [{ name: "nova", target: "https://b.example.com" }] }
    );
    expect(plan.addedActions).toEqual(["nova"]);
    expect(plan.removedActions).toEqual(["antiga"]);
    expect(plan.destructive).toBe(true);
  });
});
