const FALLBACK_PATH = "/dashboard";

/** Aceita somente destinos internos após autenticação. */
export function safeNextPath(value: string | null | undefined, fallback = FALLBACK_PATH): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  let decoded = value;
  try { decoded = decodeURIComponent(value); } catch { return fallback; }
  if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.includes("\\")) return fallback;
  try {
    const base = new URL("https://ad-studio.invalid");
    const url = new URL(value, base);
    if (url.origin !== base.origin) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return fallback; }
}
