import { expect, test } from "@playwright/test";

/**
 * Fase 4 — Preview iframe sandbox.
 *
 * Verifica o critério de aceite: o <iframe> do PreviewPane aponta para a rota
 * server-side /preview/[projectId]/[versionId] e essa rota serializa o app da
 * versão em HTML executável (root montável + arquivos embutidos + ponte de
 * runtime). O harness usa os IDs "e2e", atendidos pela rota em E2E_TEST_MODE
 * sem depender do banco. A execução do React dentro do iframe depende de CDNs
 * (react/babel/tailwind) e acontece em ambientes com rede aberta; as asserções
 * abaixo não dependem dessa execução para permanecerem determinísticas.
 */

test("o PreviewPane aponta o iframe para a rota server-side /preview", async ({ page }) => {
  await page.goto("/e2e-runtime/preview");

  const iframe = page.locator('iframe[title="Preview do app"]');
  await expect(iframe).toBeVisible();
  await expect(iframe).toHaveAttribute("src", "/preview/e2e/e2e");
  // O iframe é isolado por sandbox sem allow-same-origin (invariante de segurança).
  const sandbox = await iframe.getAttribute("sandbox");
  expect(sandbox).toContain("allow-scripts");
  expect(sandbox).not.toContain("allow-same-origin");
});

test("a rota /preview serializa o app da versão em HTML executável", async ({ request }) => {
  const response = await request.get("/preview/e2e/e2e");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/html");

  const body = await response.text();
  // Documento montável do preview.
  expect(body).toContain('<div id="root">');
  // Os arquivos da versão são serializados no HTML (o app do harness contém isto).
  expect(body).toContain("Preview OK");
  // Ponte de runtime/erros embutida (runtime-audit + reporter de erro).
  expect(body).toContain("nxPostAudit");
  expect(body).toContain("__nx_error");
});
