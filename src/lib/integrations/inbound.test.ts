import { describe, expect, it } from "vitest";
import { normalizeInboundEvent } from "./inbound";

describe("normalizeInboundEvent", () => {
  it("mantém o evento pendente de aprovação e filtra anexos inseguros", () => {
    const event = normalizeInboundEvent({
      externalId: "gmail-123",
      type: "protetico_recebido",
      status: "approved",
      attachments: [
        { name: "rx.pdf", url: "https://files.example/rx.pdf", mimeType: "application/pdf" },
        { name: "interno", url: "http://localhost/admin" },
      ],
    });
    expect(event.status).toBe("pending_review");
    expect(event.attachments).toHaveLength(1);
  });

  it("exige identificador idempotente", () => {
    expect(() => normalizeInboundEvent({ type: "boleto" })).toThrow(/externalId/);
  });
});
