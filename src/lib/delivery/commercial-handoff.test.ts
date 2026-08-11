import { describe, expect, it } from "vitest";
import { buildDeliveryChecklist, buildHandoffDocuments, deliveryIsReady } from "./commercial-handoff";

const acceptance = {
  updatedAt: "2026-07-23T00:00:00.000Z",
  structural: { valid: true, score: 100, repaired: false, errors: [], warnings: [] },
  runtime: {
    issues: [],
    stats: { buttons: 2, links: 1, forms: 1, inputs: 2, images: 1 },
    viewport: { width: 390, height: 844, overflowX: 0 },
    checkedAt: 1,
  },
};

const releaseVerification = {
  version: 1 as const,
  status: "verified" as const,
  slug: "cliente-final",
  checkedAt: "2026-07-23T00:05:00.000Z",
  bundleBytes: 1200,
};

describe("entrega comercial", () => {
  it("só libera entrega quando os requisitos obrigatórios estão comprovados", () => {
    const blocked = buildDeliveryChecklist({ meta: {}, published: false, shareSlug: null, canExport: true });
    const ready = buildDeliveryChecklist({
      meta: { client: "Cliente", acceptance, delivery: { releaseVerification } },
      published: true,
      shareSlug: "cliente-final",
      canExport: true,
    });

    expect(deliveryIsReady(blocked)).toBe(false);
    expect(deliveryIsReady(ready)).toBe(true);
  });

  it("bloqueia qualidade quando a auditoria contém erro real", () => {
    const checklist = buildDeliveryChecklist({
      meta: {
        client: "Cliente",
        acceptance: {
          ...acceptance,
          runtime: { ...acceptance.runtime, issues: [{ code: "broken", severity: "error", message: "Falha" }] },
        },
        delivery: { releaseVerification },
      },
      published: true,
      shareSlug: "cliente-final",
      canExport: true,
    });

    expect(checklist.find((item) => item.id === "quality")?.complete).toBe(false);
  });

  it("gera documentação honesta sobre domínio e vínculo com o estúdio", () => {
    const checklist = buildDeliveryChecklist({
      meta: { client: "Cliente", acceptance, delivery: { releaseVerification } },
      published: true,
      shareSlug: "cliente-final",
      canExport: true,
    });
    const files = buildHandoffDocuments({
      projectName: "Portal Cliente",
      projectId: "project-id",
      publicUrl: "https://studio.example/p/cliente-final",
      meta: { client: "Cliente", acceptance, delivery: { customDomain: "app.cliente.com", releaseVerification } },
      checklist,
    });
    const readme = files.find((file) => file.path === "ENTREGA.md")?.content || "";

    expect(readme).toContain("app.cliente.com");
    expect(readme).toContain("não altera DNS automaticamente");
    expect(files.map((file) => file.path)).toContain("qualidade.json");
  });

  it("permite a entrega de projetos do editor visual sem exigir auditoria de código", () => {
    const checklist = buildDeliveryChecklist({
      meta: {
        client: "Cliente",
        delivery: {
          releaseVerification: { ...releaseVerification, slug: "site-visual", bundleBytes: 0 },
        },
      },
      published: true,
      shareSlug: "site-visual",
      canExport: true,
      qualityRequired: false,
    });

    expect(deliveryIsReady(checklist)).toBe(true);
    expect(checklist.find((item) => item.id === "quality")?.label).toBe("Editor visual revisado");
  });

  it("não libera entrega quando o link existe, mas a versão pública não foi executada", () => {
    const checklist = buildDeliveryChecklist({
      meta: { client: "Cliente", acceptance },
      published: true,
      shareSlug: "cliente-final",
      canExport: true,
    });

    expect(checklist.find((item) => item.id === "release-verified")?.complete).toBe(false);
    expect(deliveryIsReady(checklist)).toBe(false);
  });
});
