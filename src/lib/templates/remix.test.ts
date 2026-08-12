import { describe, expect, it } from "vitest";
import { remixMeta, remixName, templateById, templateCatalog } from "./remix";

describe("templates/remix", () => {
  it("expõe catálogo categorizado", () => {
    const catalog = templateCatalog();
    expect(catalog.length).toBeGreaterThanOrEqual(8);
    expect(catalog.every((item) => !!item.category && !!item.prompt)).toBe(true);
    expect(templateById("landing-clinica")?.category).toBe("business");
  });

  it("gera nome de remix sem crescer indefinidamente", () => {
    expect(remixName("  Clínica Premium  ")).toBe("Clínica Premium · Remix");
    expect(remixName("x".repeat(200)).length).toBeLessThanOrEqual(108);
  });

  it("registra origem sem copiar segredos", () => {
    const meta = remixMeta("project-1", "landing-clinica");
    expect(meta.remixSourceProjectId).toBe("project-1");
    expect(meta.remixTemplateId).toBe("landing-clinica");
    expect(meta.remixedAt).toBeTruthy();
  });
});
