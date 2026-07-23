export type DataFieldType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "email"
  | "date"
  | "uuid"
  | "array"
  | "object";

export interface DataFieldRule {
  type: DataFieldType;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  enum?: Array<string | number | boolean>;
}

export interface DataContract {
  version: 1;
  allowUnknown: boolean;
  fields: Record<string, DataFieldRule>;
}

export interface DataValidationResult {
  valid: boolean;
  fieldErrors: Record<string, string>;
}

const FIELD_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,79}$/;
const ROLE_RE = /^[a-z][a-z0-9_-]{0,39}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TYPES: DataFieldType[] = [
  "string",
  "number",
  "integer",
  "boolean",
  "email",
  "date",
  "uuid",
  "array",
  "object",
];
const RESERVED_FIELDS = new Set(["id", "_createdAt", "__proto__", "prototype", "constructor"]);

export const EMPTY_DATA_CONTRACT: DataContract = {
  version: 1,
  allowUnknown: true,
  fields: {},
};

export function isAppRole(value: unknown): value is string {
  return typeof value === "string" && ROLE_RE.test(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSafeJson(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (finiteNumber(value)) return true;
  if (Array.isArray(value)) return value.length <= 500 && value.every((item) => isSafeJson(item, depth + 1));
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= 200 &&
    entries.every(([key, item]) => !RESERVED_FIELDS.has(key) && isSafeJson(item, depth + 1))
  );
}

export function normalizeDataContract(
  raw: unknown
): { contract?: DataContract; errors: Record<string, string> } {
  if (raw == null) return { contract: EMPTY_DATA_CONTRACT, errors: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { errors: { contract: "O contrato de dados deve ser um objeto." } };
  }

  const source = raw as Record<string, unknown>;
  const fieldsRaw = source.fields ?? {};
  if (!fieldsRaw || typeof fieldsRaw !== "object" || Array.isArray(fieldsRaw)) {
    return { errors: { fields: "fields deve ser um objeto." } };
  }

  const errors: Record<string, string> = {};
  const fields: Record<string, DataFieldRule> = {};
  const entries = Object.entries(fieldsRaw);
  if (entries.length > 100) errors.fields = "Use no máximo 100 campos por coleção.";

  for (const [name, rawRule] of entries.slice(0, 100)) {
    const prefix = `fields.${name}`;
    if (!FIELD_RE.test(name) || RESERVED_FIELDS.has(name)) {
      errors[prefix] = "Nome de campo inválido ou reservado.";
      continue;
    }
    if (!rawRule || typeof rawRule !== "object" || Array.isArray(rawRule)) {
      errors[prefix] = "A regra do campo deve ser um objeto.";
      continue;
    }
    const rule = rawRule as Record<string, unknown>;
    if (typeof rule.type !== "string" || !TYPES.includes(rule.type as DataFieldType)) {
      errors[`${prefix}.type`] = "Tipo de campo inválido.";
      continue;
    }

    const normalized: DataFieldRule = {
      type: rule.type as DataFieldType,
      required: rule.required === true,
    };
    for (const key of ["minLength", "maxLength", "min", "max"] as const) {
      if (rule[key] !== undefined) {
        if (!finiteNumber(rule[key]) || (key.includes("Length") && (rule[key] as number) < 0)) {
          errors[`${prefix}.${key}`] = "O limite deve ser um número válido.";
        } else {
          normalized[key] = rule[key] as number;
        }
      }
    }
    if (rule.pattern !== undefined) {
      if (typeof rule.pattern !== "string" || rule.pattern.length > 200) {
        errors[`${prefix}.pattern`] = "A expressão deve ter até 200 caracteres.";
      } else {
        try {
          new RegExp(rule.pattern);
          normalized.pattern = rule.pattern;
        } catch {
          errors[`${prefix}.pattern`] = "Expressão regular inválida.";
        }
      }
    }
    if (rule.enum !== undefined) {
      if (
        !Array.isArray(rule.enum) ||
        rule.enum.length > 100 ||
        !rule.enum.every((item) => ["string", "number", "boolean"].includes(typeof item))
      ) {
        errors[`${prefix}.enum`] = "enum deve conter até 100 valores simples.";
      } else {
        normalized.enum = rule.enum as Array<string | number | boolean>;
      }
    }
    fields[name] = normalized;
  }

  return {
    contract:
      Object.keys(errors).length === 0
        ? { version: 1, allowUnknown: source.allowUnknown !== false, fields }
        : undefined,
    errors,
  };
}

function matchesType(value: unknown, type: DataFieldType): boolean {
  if (type === "string") return typeof value === "string";
  if (type === "number") return finiteNumber(value);
  if (type === "integer") return finiteNumber(value) && Number.isInteger(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "email") return typeof value === "string" && EMAIL_RE.test(value);
  if (type === "date") return typeof value === "string" && !Number.isNaN(Date.parse(value));
  if (type === "uuid") return typeof value === "string" && UUID_RE.test(value);
  if (type === "array") return Array.isArray(value);
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function validateDataRecord(data: unknown, contract: DataContract): DataValidationResult {
  const fieldErrors: Record<string, string> = {};
  if (!data || typeof data !== "object" || Array.isArray(data) || !isSafeJson(data)) {
    return { valid: false, fieldErrors: { data: "O registro contém uma estrutura inválida." } };
  }

  const record = data as Record<string, unknown>;
  if (!contract.allowUnknown) {
    for (const field of Object.keys(record)) {
      if (!contract.fields[field]) fieldErrors[field] = "Campo não permitido nesta coleção.";
    }
  }

  for (const [field, rule] of Object.entries(contract.fields)) {
    const value = record[field];
    if (value === undefined || value === null || value === "") {
      if (rule.required) fieldErrors[field] = "Campo obrigatório.";
      continue;
    }
    if (!matchesType(value, rule.type)) {
      fieldErrors[field] = `Valor incompatível com o tipo ${rule.type}.`;
      continue;
    }
    if (typeof value === "string") {
      if (rule.minLength !== undefined && value.length < rule.minLength) {
        fieldErrors[field] = `Use ao menos ${rule.minLength} caracteres.`;
      } else if (rule.maxLength !== undefined && value.length > rule.maxLength) {
        fieldErrors[field] = `Use no máximo ${rule.maxLength} caracteres.`;
      } else if (rule.pattern && !new RegExp(rule.pattern).test(value)) {
        fieldErrors[field] = "Formato inválido.";
      }
    }
    if (finiteNumber(value)) {
      if (rule.min !== undefined && value < rule.min) fieldErrors[field] = `O valor mínimo é ${rule.min}.`;
      if (rule.max !== undefined && value > rule.max) fieldErrors[field] = `O valor máximo é ${rule.max}.`;
    }
    if (rule.enum && !rule.enum.includes(value as string | number | boolean)) {
      fieldErrors[field] = "Valor fora das opções permitidas.";
    }
  }

  return { valid: Object.keys(fieldErrors).length === 0, fieldErrors };
}
