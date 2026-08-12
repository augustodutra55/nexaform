import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/0021_security_function_privileges.sql"),
  "utf8"
);

describe("Supabase function privilege hardening", () => {
  it("restringe o worker ao service_role", () => {
    expect(migration).toContain("claim_staged_generation_job(text, integer) from public, anon, authenticated");
    expect(migration).toContain("claim_staged_generation_job(text, integer) to service_role");
  });

  it("remove execução anônima das RPCs autenticadas", () => {
    for (const name of [
      "finalize_generation",
      "finalize_generation_observed",
      "reserve_generation",
      "reserve_generation_observed",
      "workspace_access_role",
    ]) {
      expect(migration).toMatch(new RegExp(`revoke all on function public\\.${name}\\(`));
    }
  });

  it("não altera RPCs públicas intencionais", () => {
    expect(migration).not.toMatch(/revoke all on function public\.get_public_project\(/);
    expect(migration).not.toMatch(/revoke all on function public\.bump_view\(/);
  });

  it("fixa search_path do helper de trigger", () => {
    expect(migration).toContain("alter function public.touch_updated_at() set search_path = public");
  });
});
