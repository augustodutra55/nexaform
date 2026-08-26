import { describe, expect, it } from "vitest";
import { buildBackendActionBlueprint } from "./backend-action-blueprint";

describe("backend action blueprint", () => {
  it("aceita somente ações HTTPS nomeadas", () => {
    const result = buildBackendActionBlueprint({
      kind: "app", name: "CRM", description: "", code: '// AD_BACKEND: {"actions":[{"name":"enviar-crm","target":"https://hooks.example.com/crm"},{"name":"ruim","target":"http://localhost/admin"}]}'
    });
    expect(result.actions).toEqual([{ name: "enviar-crm", target: "https://hooks.example.com/crm" }]);
    expect(result.warnings).toHaveLength(1);
  });

  it("recusa nomes duplicados", () => {
    const result = buildBackendActionBlueprint({
      kind: "app", name: "X", description: "", code: '// AD_BACKEND: {"actions":[{"name":"sync","target":"https://a.example.com"},{"name":"sync","target":"https://b.example.com"}]}'
    });
    expect(result.actions).toHaveLength(1);
    expect(result.warnings[0]).toContain("duplicada");
  });
});
