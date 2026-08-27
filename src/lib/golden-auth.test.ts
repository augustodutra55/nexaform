import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { verifyGoldenOwnerProject, verifyGoldenServiceHeaders } from "./golden-auth";

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

  it("limita o bypass assinado a um projeto do owner", async () => {
    vi.stubEnv("AD_GOLDEN_SERVICE_SECRET", "segredo-de-teste");
    const timestamp = String(Date.now());
    const signature = crypto.createHmac("sha256", "segredo-de-teste").update(timestamp).digest("hex");
    const request = new Request("https://example.test", {
      headers: {
        "x-ad-golden-timestamp": timestamp,
        "x-ad-golden-signature": signature,
      },
    });
    const projectQuery = {
      select: () => projectQuery,
      eq: () => projectQuery,
      maybeSingle: async () => ({ data: { user_id: "owner-id" } }),
    };
    const profileQuery = {
      select: () => profileQuery,
      eq: () => profileQuery,
      maybeSingle: async () => ({ data: { role: "owner" } }),
    };
    const admin = {
      from: (table: string) => table === "projects" ? projectQuery : profileQuery,
      auth: { admin: { getUserById: async () => ({ data: { user: { email: "owner@example.test" } } }) } },
    };

    expect(await verifyGoldenOwnerProject(request, "project-id", admin as any)).toBe(true);
    vi.unstubAllEnvs();
  });
});
