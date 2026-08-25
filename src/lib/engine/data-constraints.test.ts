import { describe, expect, it } from "vitest";
import { findDeleteReference, validateDataConstraints } from "./data-constraints";

function adminWith(results: Array<Record<string, unknown>>) {
  const calls: Array<Array<unknown>> = [];
  return {
    calls,
    from(table: string) {
      const result = results.shift() || { data: null, error: null };
      const query: any = {
        select(...args: unknown[]) { calls.push([table, "select", ...args]); return query; },
        eq(...args: unknown[]) { calls.push([table, "eq", ...args]); return query; },
        neq(...args: unknown[]) { calls.push([table, "neq", ...args]); return query; },
        maybeSingle() { calls.push([table, "maybeSingle"]); return Promise.resolve(result); },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

describe("restrições relacionais do backend", () => {
  it("bloqueia valor duplicado e referência inexistente", async () => {
    const admin = adminWith([
      { count: 1, error: null },
      { data: null, error: null },
    ]);
    const violation = await validateDataConstraints(admin, "project", {
      email: "ana@example.com",
      clienteId: "00000000-0000-4000-8000-000000000001",
    }, {
      version: 1,
      allowUnknown: false,
      fields: {
        email: { type: "email", unique: true },
        clienteId: { type: "uuid", reference: { collection: "clientes", onDelete: "restrict" } },
      },
    });
    expect(violation?.fieldErrors).toEqual({
      email: "Este valor já está em uso.",
      clienteId: "Registro relacionado não encontrado em clientes.",
    });
  });

  it("ignora o próprio registro ao validar unicidade numa atualização", async () => {
    const admin = adminWith([{ count: 0, error: null }]);
    expect(await validateDataConstraints(admin, "project", { codigo: "ABC" }, {
      version: 1,
      allowUnknown: false,
      fields: { codigo: { type: "string", unique: true } },
    }, "current-id")).toBeNull();
    expect(admin.calls).toContainEqual(["app_data", "neq", "id", "current-id"]);
  });

  it("encontra dependência antes de excluir o registro pai", async () => {
    const admin = adminWith([
      { data: [{ collection: "agendamentos", data_contract: { fields: { clienteId: { reference: { collection: "clientes" } } } } }], error: null },
      { count: 2, error: null },
    ]);
    await expect(findDeleteReference(admin, "project", "clientes", "cliente-id"))
      .resolves.toEqual({ collection: "agendamentos", field: "clienteId" });
  });
});
