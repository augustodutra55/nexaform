export interface NormalizedInboundEvent {
  externalId: string;
  type: string;
  source: string;
  status: "pending_review";
  subject: string;
  sender: string;
  receivedAt: string;
  payload: Record<string, unknown>;
  attachments: Array<{ name: string; url: string; mimeType: string }>;
}

function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeHttps(value: unknown): string {
  try {
    const url = new URL(clip(value, 2_000));
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "";
  } catch {
    return "";
  }
}

/** Normaliza o contrato recebido sem permitir que a automação aprove a própria ação. */
export function normalizeInboundEvent(raw: unknown, now = new Date()): NormalizedInboundEvent {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const externalId = clip(input.externalId, 240);
  if (!externalId) throw new Error("externalId é obrigatório para impedir eventos duplicados.");
  const parsedDate = new Date(clip(input.receivedAt, 80));
  const payload = input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
    ? input.payload as Record<string, unknown>
    : {};
  const attachments = Array.isArray(input.attachments)
    ? input.attachments.slice(0, 20).flatMap((value) => {
        const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
        const url = safeHttps(item.url);
        return url ? [{ name: clip(item.name, 240), url, mimeType: clip(item.mimeType, 160) }] : [];
      })
    : [];
  return {
    externalId,
    type: clip(input.type, 80) || "unclassified",
    source: clip(input.source, 80) || "external_automation",
    status: "pending_review",
    subject: clip(input.subject, 500),
    sender: clip(input.sender, 320),
    receivedAt: Number.isNaN(parsedDate.getTime()) ? now.toISOString() : parsedDate.toISOString(),
    payload,
    attachments,
  };
}
