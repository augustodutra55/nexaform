import { describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { verifyGoldenServiceHeaders } from "./golden-auth";

describe("golden service auth", () => {
  it("aceita assinatura HMAC recente e rejeita assinatura inválida", () => {
    vi.stubEnv("AD_GOLDEN_SERVICE_SECRET", "segredo-de-teste");
    const timestamp = String(Date.now());
    const signature = crypto.createHmac("sha256", "segredo-de-teste").update(timestamp).digest("hex");
    expect(verifyGoldenServiceHeaders(new Headers({
      "x-ad-golden-timestamp": timestamp,
      "x-ad-golden-signature": signature,
    }))).toBe(true);
    expect(verifyGoldenServiceHeaders(new Headers({
      "x-ad-golden-timestamp": timestamp,
      "x-ad-golden-signature": "00",
    }))).toBe(false);
    vi.unstubAllEnvs();
  });
});
