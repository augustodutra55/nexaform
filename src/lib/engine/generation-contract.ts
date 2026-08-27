import type { GenerationPlan } from "./app-types";

/**
 * O plano salvo representa o produto pedido, não o último comando de edição.
 * Refinamentos podem acrescentar código, mas não podem trocar "clínica
 * odontológica" por "corrija o e-mail" como objetivo oficial do projeto.
 */
export function projectGenerationPlan(
  existing: GenerationPlan | undefined,
  candidate: GenerationPlan | undefined,
  hasExistingApp: boolean
): GenerationPlan | undefined {
  if (hasExistingApp && existing) return existing;
  return candidate || existing;
}
