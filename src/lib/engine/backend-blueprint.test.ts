import { describe, expect, it } from "vitest";
import { buildBackendBlueprint } from "./backend-blueprint";
import type { AppCode } from "./app-types";

function app(code: string): AppCode {
  return { kind: "app", name: "Teste", description: "", code };
}

describe("buildBackendBlueprint", () => {
  it("configura catálogo somente leitura automaticamente", () => {
    const blueprint = buildBackendBlueprint(app("AD.list('produtos').then(setProdutos)"));
    expect(blueprint.status).toBe("ready");
    expect(blueprint.collections[0]).toMatchObject({
      collection: "produtos",
      profile: "catalog",
      operations: ["read"],
    });
  });

  it("configura formulário público sem liberar leitura", () => {
    const blueprint = buildBackendBlueprint(
      app("await AD.insert('leads', { nome, email, ativo: true })")
    );
    expect(blueprint.collections[0].profile).toBe("form");
    expect(blueprint.collections[0].dataContract.fields).toMatchObject({
      ativo: { type: "boolean" },
    });
    expect(blueprint.collections[0].dataContract.fields).not.toHaveProperty("nome");
    expect(blueprint.collections[0].dataContract.fields).not.toHaveProperty("email");
  });

  it("isola dados quando o aplicativo usa autenticação", () => {
    const blueprint = buildBackendBlueprint(
      app("await AD.auth.signIn(email, senha); await AD.list('pedidos'); await AD.insert('pedidos', { total: 10.5 });")
    );
    expect(blueprint.usesAuth).toBe(true);
    expect(blueprint.collections[0]).toMatchObject({
      collection: "pedidos",
      profile: "authenticated",
      authenticatedScope: "own",
      confidence: "high",
    });
  });

  it("mantém privada uma coleção mutável sem identidade", () => {
    const blueprint = buildBackendBlueprint(
      app("await AD.list('clientes'); await AD.insert('clientes', { nome });")
    );
    expect(blueprint.status).toBe("review");
    expect(blueprint.collections[0].profile).toBe("private");
  });

  it("prioriza o manifesto explícito e completa as operações inferidas", () => {
    const blueprint = buildBackendBlueprint(
      app(
        '// AD_BACKEND: {"collections":[{"name":"ordens","profile":"authenticated","allowedRoles":["gestor"],"authenticatedScope":"all","fields":{"status":{"type":"string","required":true}},"allowUnknown":false}]}\n' +
        "AD.list('ordens')"
      )
    );
    expect(blueprint.collections[0]).toMatchObject({
      collection: "ordens",
      profile: "authenticated",
      allowedRoles: ["gestor"],
      authenticatedScope: "all",
      source: "manifest",
      operations: ["read"],
    });
    expect(blueprint.collections[0].dataContract.allowUnknown).toBe(false);
  });

  it("não libera leitura pública inferida quando o app usa login", () => {
    const blueprint = buildBackendBlueprint(
      app("await AD.auth.me(); await AD.list('perfil')")
    );
    expect(blueprint.collections[0]).toMatchObject({
      collection: "perfil",
      profile: "authenticated",
      operations: ["read"],
    });
  });

  it("mantém formulário público conhecido em aplicativo híbrido com login", () => {
    const blueprint = buildBackendBlueprint(
      app("await AD.auth.me(); await AD.insert('leads', { nome, email })")
    );
    expect(blueprint.collections[0]).toMatchObject({
      collection: "leads",
      profile: "form",
      operations: ["insert"],
    });
  });

  it("detecta update e remove associados às coleções do mesmo módulo", () => {
    const blueprint = buildBackendBlueprint(
      app("const itens = await AD.list('clientes'); await AD.update(id, { nome }); await AD.remove(id)")
    );
    expect(blueprint.status).toBe("review");
    expect(blueprint.collections[0]).toMatchObject({
      collection: "clientes",
      profile: "private",
      operations: ["read", "update", "delete"],
    });
  });

  it("não restringe propriedades abreviadas a string", () => {
    const blueprint = buildBackendBlueprint(
      app("await AD.insert('pedidos', { quantidade, total, pago: false })")
    );
    expect(blueprint.collections[0].dataContract.fields).toEqual({
      pago: { type: "boolean" },
    });
    expect(blueprint.collections[0].dataContract.allowUnknown).toBe(true);
  });
});
