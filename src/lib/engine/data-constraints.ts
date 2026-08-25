import type { DataContract } from "./data-contract";

export interface ConstraintViolation {
  fieldErrors: Record<string, string>;
}

/** Valida regras que dependem do banco depois da validação estrutural local:
 * unicidade e referências entre coleções do mesmo projeto. */
export async function validateDataConstraints(
  admin: any,
  projectId: string,
  data: Record<string, unknown>,
  contract: DataContract,
  excludeId?: string
): Promise<ConstraintViolation | null> {
  const fieldErrors: Record<string, string> = {};
  for (const [field, rule] of Object.entries(contract.fields)) {
    const value = data[field];
    if (value === undefined || value === null || value === "") continue;

    if (rule.unique) {
      let query = admin
        .from("app_data")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq(`data->>${field}`, String(value));
      if (excludeId) query = query.neq("id", excludeId);
      const { count, error } = await query;
      if (error) throw error;
      if ((count ?? 0) > 0) fieldErrors[field] = "Este valor já está em uso.";
    }

    if (rule.reference && !fieldErrors[field]) {
      const { data: referenced, error } = await admin
        .from("app_data")
        .select("id")
        .eq("project_id", projectId)
        .eq("collection", rule.reference.collection)
        .eq("id", String(value))
        .maybeSingle();
      if (error) throw error;
      if (!referenced) fieldErrors[field] = `Registro relacionado não encontrado em ${rule.reference.collection}.`;
    }
  }
  return Object.keys(fieldErrors).length ? { fieldErrors } : null;
}

/** Impede apagar um registro ainda referenciado por outra coleção. */
export async function findDeleteReference(
  admin: any,
  projectId: string,
  collection: string,
  id: string
): Promise<{ collection: string; field: string } | null> {
  const { data: settings, error } = await admin
    .from("app_collection_settings")
    .select("collection, data_contract")
    .eq("project_id", projectId);
  if (error) throw error;
  for (const item of settings ?? []) {
    const fields = item?.data_contract?.fields;
    if (!fields || typeof fields !== "object") continue;
    for (const [field, rawRule] of Object.entries(fields as Record<string, any>)) {
      if (rawRule?.reference?.collection !== collection) continue;
      const { count, error: countError } = await admin
        .from("app_data")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("collection", item.collection)
        .eq(`data->>${field}`, id);
      if (countError) throw countError;
      if ((count ?? 0) > 0) return { collection: item.collection, field };
    }
  }
  return null;
}
