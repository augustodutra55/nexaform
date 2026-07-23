import type { AppCode, AppFile } from "./app-types";
import {
  EMPTY_DATA_CONTRACT,
  normalizeDataContract,
  type DataContract,
  type DataFieldRule,
} from "./data-contract";
import type { CollectionProfile } from "./collection-access";

export interface BackendCollectionBlueprint {
  collection: string;
  profile: CollectionProfile;
  allowedRoles: string[];
  authenticatedScope: "own" | "all";
  dataContract: DataContract;
  operations: Array<"read" | "insert" | "update" | "delete">;
  source: "manifest" | "inferred";
  confidence: "high" | "review";
  reason: string;
}

export interface BackendBlueprint {
  version: 1;
  usesAuth: boolean;
  collections: BackendCollectionBlueprint[];
  warnings: string[];
  status: "ready" | "review";
}

interface ManifestCollection {
  name?: unknown;
  profile?: unknown;
  allowedRoles?: unknown;
  authenticatedScope?: unknown;
  fields?: unknown;
  allowUnknown?: unknown;
}

const COLLECTION_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/;
const PROFILES: CollectionProfile[] = ["catalog", "form", "authenticated", "private", "custom"];
const PUBLIC_CATALOGS = new Set([
  "produtos",
  "servicos",
  "serviços",
  "planos",
  "depoimentos",
  "categorias",
  "cardapio",
  "cardápio",
  "imoveis",
  "imóveis",
  "itens",
  "portfolio",
  "portfólio",
]);
const PUBLIC_FORMS = new Set([
  "contatos",
  "leads",
  "orcamentos",
  "orçamentos",
  "agendamentos",
  "mensagens",
  "newsletter",
]);

function appFiles(app: AppCode): AppFile[] {
  if (Array.isArray(app.files) && app.files.length) return app.files;
  return [{ path: "App.jsx", content: app.code || "" }];
}

function unique<T>(items: T[]): T[] {
  return items.filter((item, index) => items.indexOf(item) === index);
}

function manifestFrom(files: AppFile[]): { collections: ManifestCollection[] } | null {
  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    for (const line of lines) {
      const marker = line.indexOf("AD_BACKEND:");
      if (marker < 0) continue;
      const raw = line.slice(marker + "AD_BACKEND:".length).trim().replace(/\*\/\s*$/, "").trim();
      try {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.collections)) return parsed;
      } catch {
        // Um manifesto malformado não impede a inferência segura.
      }
    }
  }
  return null;
}

function normalizeFields(raw: unknown): DataContract {
  const result = normalizeDataContract({
    version: 1,
    allowUnknown: true,
    fields: raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {},
  });
  return result.contract || EMPTY_DATA_CONTRACT;
}

function manifestBlueprint(
  manifest: { collections: ManifestCollection[] },
  usesAuth: boolean
): BackendCollectionBlueprint[] {
  const result: BackendCollectionBlueprint[] = [];
  for (const item of manifest.collections.slice(0, 60)) {
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!COLLECTION_RE.test(name)) continue;
    const profile = typeof item.profile === "string" && PROFILES.includes(item.profile as CollectionProfile)
      ? (item.profile as CollectionProfile)
      : usesAuth
        ? "authenticated"
        : "private";
    const roles = Array.isArray(item.allowedRoles)
      ? unique(item.allowedRoles.filter((role): role is string => typeof role === "string"))
      : [];
    result.push({
      collection: name,
      profile,
      allowedRoles: roles.slice(0, 40),
      authenticatedScope: item.authenticatedScope === "all" ? "all" : "own",
      dataContract: {
        ...normalizeFields(item.fields),
        allowUnknown: item.allowUnknown !== false,
      },
      operations: [],
      source: "manifest",
      confidence: "high",
      reason: "Contrato declarado pelo projeto gerado.",
    });
  }
  return result;
}

function operationFor(method: string): "read" | "insert" | "update" | "delete" {
  if (method === "insert") return "insert";
  if (method === "update") return "update";
  if (method === "remove") return "delete";
  return "read";
}

function inferType(value: string): DataFieldRule["type"] {
  const normalized = value.trim();
  if (/^(?:true|false)\b/.test(normalized)) return "boolean";
  if (/^-?\d+(?:\.\d+)?\b/.test(normalized)) return normalized.indexOf(".") >= 0 ? "number" : "integer";
  if (/^\[/.test(normalized)) return "array";
  if (/^\{/.test(normalized)) return "object";
  return "string";
}

function inferInsertFields(content: string, collection: string): Record<string, DataFieldRule> {
  const escaped = collection.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(
    "(?:window\\.)?AD\\.insert\\(\\s*['\"]" + escaped + "['\"]\\s*,\\s*\\{([\\s\\S]{0,2500}?)\\}\\s*\\)",
    "g"
  );
  const fields: Record<string, DataFieldRule> = {};
  let match: RegExpExecArray | null;
  while ((match = expression.exec(content))) {
    const body = match[1];
    const keyExpression = /(?:^|,)\s*([a-zA-Z][a-zA-Z0-9_]{0,79})\s*(?::\s*([^,\n}]+))?/g;
    let keyMatch: RegExpExecArray | null;
    while ((keyMatch = keyExpression.exec(body))) {
      const key = keyMatch[1];
      if (["id", "_createdAt", "__proto__", "constructor", "prototype"].includes(key)) continue;
      fields[key] = { type: inferType(keyMatch[2] || "") };
    }
  }
  return fields;
}

function inferredProfile(
  name: string,
  operations: BackendCollectionBlueprint["operations"],
  usesAuth: boolean
): Pick<BackendCollectionBlueprint, "profile" | "confidence" | "reason"> {
  const hasRead = operations.includes("read");
  const hasInsert = operations.includes("insert");
  const hasMutation = operations.some((operation) => operation !== "read");
  const normalized = name.toLowerCase();
  if (usesAuth && hasMutation) {
    return {
      profile: "authenticated",
      confidence: "high",
      reason: "O aplicativo usa autenticação e grava dados por usuário.",
    };
  }
  if (PUBLIC_FORMS.has(normalized) || (hasInsert && !hasRead && !operations.includes("update") && !operations.includes("delete"))) {
    return {
      profile: "form",
      confidence: "high",
      reason: "Coleção usada como formulário público sem leitura dos envios.",
    };
  }
  if (PUBLIC_CATALOGS.has(normalized) && hasRead && !hasMutation) {
    return {
      profile: "catalog",
      confidence: "high",
      reason: "Coleção reconhecida como catálogo público somente para leitura.",
    };
  }
  if (hasRead && !hasMutation) {
    return {
      profile: "catalog",
      confidence: "high",
      reason: "Coleção somente para leitura no aplicativo publicado.",
    };
  }
  return {
    profile: "private",
    confidence: "review",
    reason: "Há leitura e gravação sem login; a coleção foi mantida privada por segurança.",
  };
}

function inferredBlueprint(files: AppFile[], usesAuth: boolean): BackendCollectionBlueprint[] {
  const operations = new Map<string, BackendCollectionBlueprint["operations"]>();
  const fields = new Map<string, Record<string, DataFieldRule>>();
  const callExpression = /(?:window\.)?AD\.(list|get|count|insert)\(\s*['"]([a-zA-Z][a-zA-Z0-9_-]{0,79})['"]/g;

  for (const file of files) {
    let match: RegExpExecArray | null;
    while ((match = callExpression.exec(file.content))) {
      const method = match[1];
      const collection = match[2];
      const current = operations.get(collection) || [];
      current.push(operationFor(method));
      operations.set(collection, unique(current));
      if (method === "insert") {
        fields.set(collection, { ...(fields.get(collection) || {}), ...inferInsertFields(file.content, collection) });
      }
    }
    if (/(?:window\.)?AD\.email\s*\(/.test(file.content)) {
      operations.set("contatos", unique([...(operations.get("contatos") || []), "insert"]));
      fields.set("contatos", {
        name: { type: "string" },
        email: { type: "email" },
        subject: { type: "string" },
        message: { type: "string" },
      });
    }
  }

  return Array.from(operations.entries()).map(([collection, collectionOperations]) => {
    const access = inferredProfile(collection, collectionOperations, usesAuth);
    return {
      collection,
      ...access,
      allowedRoles: [],
      authenticatedScope: "own",
      dataContract: {
        version: 1,
        allowUnknown: true,
        fields: fields.get(collection) || {},
      },
      operations: collectionOperations,
      source: "inferred",
    };
  });
}

export function buildBackendBlueprint(app: AppCode): BackendBlueprint {
  const files = appFiles(app);
  const joined = files.map((file) => file.content).join("\n");
  const usesAuth = /(?:window\.)?AD\.auth\.(?:signUp|signIn|me|signOut)\s*\(/.test(joined);
  const manifest = manifestFrom(files);
  const declared = manifest ? manifestBlueprint(manifest, usesAuth) : [];
  const inferred = inferredBlueprint(files, usesAuth);
  const byCollection = new Map<string, BackendCollectionBlueprint>();

  for (const collection of declared) byCollection.set(collection.collection, collection);
  for (const collection of inferred) {
    const existing = byCollection.get(collection.collection);
    if (existing) {
      existing.operations = collection.operations;
      if (Object.keys(existing.dataContract.fields).length === 0) {
        existing.dataContract = collection.dataContract;
      }
    } else {
      byCollection.set(collection.collection, collection);
    }
  }

  const collections = Array.from(byCollection.values()).sort((a, b) =>
    a.collection.localeCompare(b.collection, "pt-BR")
  );
  const warnings = collections
    .filter((collection) => collection.confidence === "review")
    .map((collection) => `${collection.collection}: ${collection.reason}`);
  if (usesAuth && collections.length === 0) {
    warnings.push("O aplicativo usa login, mas nenhuma coleção de dados foi encontrada.");
  }

  return {
    version: 1,
    usesAuth,
    collections,
    warnings,
    status: warnings.length ? "review" : "ready",
  };
}
