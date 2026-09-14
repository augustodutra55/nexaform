import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { createAdminClientMock, verifyGoldenServiceAuthMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  verifyGoldenServiceAuthMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/golden-auth", () => ({ verifyGoldenServiceAuth: verifyGoldenServiceAuthMock }));
vi.mock("@/lib/engine/code-providers", () => ({ generateAppWithProviders: vi.fn() }));

import { POST } from "./route";

describe("rota de geração Golden", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyGoldenServiceAuthMock.mockReturnValue(true);
  });

  it("trata falha transitória do banco como recuperável em vez de projeto inexistente", async () => {
    createAdminClientMock.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: null, error: { message: "upstream timeout" } })),
          })),
        })),
      })),
    });

    const response = await POST(new NextRequest("https://ad.example/api/golden/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "f7f68e5d-08ea-4c3f-b1fa-fc127b46a92e",
        message: "Crie uma agenda clínica.",
      }),
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Não foi possível validar o projeto Golden." });
  });
});
