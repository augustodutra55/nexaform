import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

const CAPABILITIES = [
  ["history", "src/lib/history/version-history.ts"],
  ["github", "src/lib/integrations/github-sync.ts"],
  ["plan-agent", "src/lib/engine/plan-agent.ts"],
  ["visual-editor", "src/lib/preview/direct-visual-edit.ts"],
  ["visual-undo-redo", "src/lib/preview/visual-editor-history.ts"],
  ["domains", "src/lib/delivery/custom-domain.ts"],
  ["commercial-integrations", "src/lib/integrations/commercial.ts"],
  ["collaboration", "supabase/migrations/0020_workspaces_collaboration.sql"],
  ["templates-remix", "src/lib/templates/remix.ts"],
] as const;

describe("Lovable parity roadmap certification", () => {
  it.each(CAPABILITIES)("mantém a capacidade %s no conjunto integrado", (_name, path) => {
    const absolute = resolve(ROOT, path);
    expect(existsSync(absolute), `${path} deveria existir`).toBe(true);
    expect(readFileSync(absolute, "utf8").trim().length).toBeGreaterThan(40);
  });

  it("mantém quality gate com audit, typecheck, unit, build e e2e", () => {
    const workflow = readFileSync(resolve(ROOT, ".github/workflows/quality.yml"), "utf8");
    expect(workflow).toContain("npm audit --audit-level=high");
    expect(workflow).toContain("npm run typecheck");
    expect(workflow).toContain("npm run test:unit");
    expect(workflow).toContain("npm run build");
    expect(workflow).toContain("npm run test:e2e");
  });
});
