import type { BackendBlueprint, BackendCollectionBlueprint } from "./backend-blueprint";

export interface BackendChangePlan {
  addedCollections: string[];
  removedCollections: string[];
  changedCollections: Array<{
    collection: string;
    addedFields: string[];
    removedFields: string[];
    accessChanged: boolean;
  }>;
  destructive: boolean;
  changed: boolean;
}

function byName(collections: BackendCollectionBlueprint[]): Map<string, BackendCollectionBlueprint> {
  return new Map(collections.map((item) => [item.collection, item]));
}

/** Compara o contrato aplicado com o contrato atual sem executar SQL arbitrário. */
export function buildBackendChangePlan(
  previous: Pick<BackendBlueprint, "collections"> | null | undefined,
  next: Pick<BackendBlueprint, "collections">
): BackendChangePlan {
  const before = byName(previous?.collections ?? []);
  const after = byName(next.collections);
  const addedCollections = Array.from(after.keys()).filter((name) => !before.has(name)).sort();
  const removedCollections = Array.from(before.keys()).filter((name) => !after.has(name)).sort();
  const changedCollections = Array.from(after.entries()).flatMap(([collection, current]) => {
    const old = before.get(collection);
    if (!old) return [];
    const oldFields = new Set(Object.keys(old.dataContract.fields));
    const nextFields = new Set(Object.keys(current.dataContract.fields));
    const addedFields = Array.from(nextFields).filter((field) => !oldFields.has(field)).sort();
    const removedFields = Array.from(oldFields).filter((field) => !nextFields.has(field)).sort();
    const accessChanged = old.profile !== current.profile
      || old.authenticatedScope !== current.authenticatedScope
      || JSON.stringify(old.allowedRoles) !== JSON.stringify(current.allowedRoles)
      || old.dataContract.allowUnknown !== current.dataContract.allowUnknown;
    return addedFields.length || removedFields.length || accessChanged
      ? [{ collection, addedFields, removedFields, accessChanged }]
      : [];
  });
  const destructive = removedCollections.length > 0 || changedCollections.some((item) => item.removedFields.length > 0);
  return {
    addedCollections,
    removedCollections,
    changedCollections,
    destructive,
    changed: addedCollections.length > 0 || removedCollections.length > 0 || changedCollections.length > 0,
  };
}
