export type AiProviderPreference = "claude" | "openrouter" | "local" | null | undefined;

/**
 * OpenRouter é o automático da plataforma. Claude só assume prioridade quando
 * o usuário o escolhe; local é um modo explícito que não consulta provedores.
 */
export function environmentProviderOrder(
  preference: AiProviderPreference
): Array<"openrouter" | "claude"> {
  if (preference === "local") return [];
  return preference === "claude"
    ? ["claude", "openrouter"]
    : ["openrouter", "claude"];
}
