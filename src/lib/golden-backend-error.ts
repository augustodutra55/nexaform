export function formatGoldenBackendError(payload: unknown, status: number): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
    if (error && typeof error === "object" && "message" in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    }
    if (error !== undefined) {
      try {
        return JSON.stringify(error);
      } catch {}
    }
  }
  return `Backend Golden não foi provisionado (HTTP ${status}).`;
}
