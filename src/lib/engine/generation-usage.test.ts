import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { POSTGRES_INTEGER_MAX, reserveGeneration } from "./generation-usage";

describe("reserveGeneration", () => {
  it("mantém o Owner ilimitado sem ultrapassar o integer do PostgreSQL", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { state: "reserved", id: "generation-1", attempt: 1 },
      error: null,
    });
    const supabase = { rpc } as unknown as SupabaseClient;

    const result = await reserveGeneration({
      supabase,
      userId: "owner-1",
      projectId: "project-1",
      prompt: "Crie uma esmalteria com agenda",
      limit: Number.MAX_SAFE_INTEGER,
      unlimited: true,
      requestId: "request-1",
      kind: "app",
    });

    expect(rpc).toHaveBeenCalledWith("reserve_generation_observed", expect.objectContaining({
      p_limit: POSTGRES_INTEGER_MAX,
    }));
    expect(result).toMatchObject({
      id: "generation-1",
      limitReached: false,
      observed: true,
    });
  });

  it("também limita valores configurados acima do int4 para planos comuns", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { state: "reserved", id: "generation-2", attempt: 1 },
      error: null,
    });
    const supabase = { rpc } as unknown as SupabaseClient;

    await reserveGeneration({
      supabase,
      userId: "user-1",
      projectId: "project-1",
      prompt: "Crie um app",
      limit: Number.MAX_SAFE_INTEGER,
      requestId: "request-2",
    });

    expect(rpc).toHaveBeenCalledWith("reserve_generation_observed", expect.objectContaining({
      p_limit: POSTGRES_INTEGER_MAX,
    }));
  });
});
