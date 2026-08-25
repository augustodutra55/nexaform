import { describe, expect, it } from "vitest";
import {
  EMPTY_DATA_CONTRACT,
  normalizeDataContract,
  validateDataRecord,
} from "./data-contract";

describe("contratos de dados", () => {
  it("aceita JSON seguro quando a coleção ainda não tem esquema fechado", () => {
    expect(validateDataRecord({ nome: "Ana", ativo: true }, EMPTY_DATA_CONTRACT)).toEqual({
      valid: true,
      fieldErrors: {},
    });
  });

  it("rejeita campo ausente, tipo incorreto e campo desconhecido", () => {
    const normalized = normalizeDataContract({
      version: 1,
      allowUnknown: false,
      fields: {
        email: { type: "email", required: true },
        idade: { type: "integer", min: 18 },
      },
    });
    expect(normalized.errors).toEqual({});
    const result = validateDataRecord(
      { idade: 17.5, invasor: "não permitido" },
      normalized.contract!
    );
    expect(result.valid).toBe(false);
    expect(result.fieldErrors.email).toBe("Campo obrigatório.");
    expect(result.fieldErrors.idade).toContain("integer");
    expect(result.fieldErrors.invasor).toContain("não permitido");
  });

  it("valida limites, enum e formato de texto", () => {
    const normalized = normalizeDataContract({
      fields: {
        nome: { type: "string", minLength: 3, maxLength: 20 },
        status: { type: "string", enum: ["novo", "ativo"] },
        codigo: { type: "string", pattern: "^[A-Z]{3}$" },
      },
    });
    const result = validateDataRecord(
      { nome: "A", status: "bloqueado", codigo: "abc" },
      normalized.contract!
    );
    expect(result.fieldErrors).toEqual({
      nome: "Use ao menos 3 caracteres.",
      status: "Valor fora das opções permitidas.",
      codigo: "Formato inválido.",
    });
  });

  it("bloqueia nomes reservados e contratos malformados", () => {
    const result = normalizeDataContract({
      fields: {
        id: { type: "uuid" },
        nome: { type: "desconhecido" },
      },
    });
    expect(result.contract).toBeUndefined();
    expect(Object.keys(result.errors)).toEqual(
      expect.arrayContaining(["fields.id", "fields.nome.type"])
    );
  });

  it("normaliza unicidade e relações entre coleções", () => {
    const result = normalizeDataContract({
      fields: {
        email: { type: "email", required: true, unique: true },
        clienteId: { type: "uuid", reference: { collection: "clientes" } },
      },
    });
    expect(result.errors).toEqual({});
    expect(result.contract?.fields.email.unique).toBe(true);
    expect(result.contract?.fields.clienteId.reference).toEqual({
      collection: "clientes",
      onDelete: "restrict",
    });
  });

  it("recusa referência sem uuid ou com coleção inválida", () => {
    const result = normalizeDataContract({
      fields: {
        cliente: { type: "string", reference: { collection: "clientes" } },
        produtoId: { type: "uuid", reference: { collection: "../produtos" } },
      },
    });
    expect(result.contract).toBeUndefined();
    expect(result.errors).toHaveProperty("fields.cliente.reference");
    expect(result.errors).toHaveProperty("fields.produtoId.reference");
  });
});
