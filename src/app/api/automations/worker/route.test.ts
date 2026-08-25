import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const previousSecret = process.env.CRON_SECRET;

afterEach(() => {
  if (previousSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousSecret;
});

describe("worker de automações", () => {
  it("recusa execução sem o segredo do cron", async () => {
    process.env.CRON_SECRET = "segredo-de-teste";
    const response = await GET(new NextRequest("https://ad.example/api/automations/worker"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Não autorizado." });
  });
});
