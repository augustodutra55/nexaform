import type { BackendCollectionBlueprint } from "./backend-blueprint";
import { PRIVATE_PERMISSIONS } from "./collection-access";

export function settingsForCollection(item: BackendCollectionBlueprint) {
  const base = {
    ...PRIVATE_PERMISSIONS,
    project_id: "",
    collection: item.collection,
    profile: item.profile === "custom" ? "private" : item.profile,
    allowed_roles: item.allowedRoles,
    authenticated_scope: item.authenticatedScope,
    data_contract: item.dataContract,
  };
  if (item.profile === "catalog") return { ...base, public_read: true, owner_only: false };
  if (item.profile === "form") {
    return {
      ...base,
      public_insert: true,
      authenticated_read: item.allowedRoles.length > 0 && item.operations.includes("read"),
      authenticated_update: item.allowedRoles.length > 0 && item.operations.includes("update"),
      authenticated_delete: item.allowedRoles.length > 0 && item.operations.includes("delete"),
      authenticated_scope: "all" as const,
      owner_only: false,
    };
  }
  if (item.profile === "authenticated") {
    const fullManifestAccess = item.source === "manifest" && item.operations.length === 0;
    return {
      ...base,
      authenticated_read: fullManifestAccess || item.operations.includes("read"),
      authenticated_insert: fullManifestAccess || item.operations.includes("insert"),
      authenticated_update: fullManifestAccess || item.operations.includes("update"),
      authenticated_delete: fullManifestAccess || item.operations.includes("delete"),
      owner_only: false,
    };
  }
  return base;
}
