import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

interface GoldenFixture {
  id: string;
  name: string;
  refinement?: {
    passed?: boolean;
    targetText?: string;
  } | null;
}

function fixtures(): GoldenFixture[] {
  const configured = process.env.GOLDEN_FIXTURE_PATH || "artifacts/golden-apps.json";
  const absolute = path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  try {
    const parsed = JSON.parse(fs.readFileSync(absolute, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function assertRuntime(page: Page, fixture: GoldenFixture) {
  await page.goto(`/e2e-runtime/golden?id=${encodeURIComponent(fixture.id)}`);
  await expect(page.getByTestId("golden-case")).toHaveText(fixture.id);
  await expect(page.getByTestId("golden-runtime-ready")).toBeAttached({ timeout: 45_000 });
  await expect(page.getByTestId("golden-runtime-error")).toHaveCount(0);
  await expect(page.getByTestId("golden-runtime-audit")).toHaveText("0:0");
  // O gate só marca o preview como pronto depois de executar o smoke seguro.
  // Uma tela inicial pode oferecer navegação (landing/dashboard) ou apenas
  // campos editáveis (login). Ambos provam interação real sem enviar dados.
  const smoke = page.getByTestId("golden-runtime-smoke");
  await expect(smoke).toHaveText(/^\d+:\d+:\d+:\d+$/, { timeout: 15_000 });
  const [attempted, changed, fieldsAttempted, fieldsEditable] = (await smoke.innerText())
    .split(":")
    .map(Number);
  expect(changed).toBeLessThanOrEqual(attempted);
  expect(fieldsEditable).toBe(fieldsAttempted);
  expect(changed + fieldsEditable).toBeGreaterThan(0);

  const frame = page.frameLocator('iframe[title="Preview do app"]');
  if (fixture.refinement?.passed && fixture.refinement.targetText) {
    await expect(frame.getByText(fixture.refinement.targetText, { exact: true }).first()).toBeVisible();
  }
  const overflow = await frame.locator("html").evaluate((html) => html.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(8);
}

test.describe("Golden 3.0 · criação, refinamento e runtime reais", () => {
  test.describe.configure({ mode: "serial" });
  const cases = fixtures();
  test.skip(cases.length === 0, "Executado somente pelo workflow Golden com artefatos reais.");

  test("recebe os cinco artefatos aprovados pelo avaliador", () => {
    expect(cases.map((item) => item.id).sort()).toEqual(["agenda", "commerce", "dashboard", "landing", "media"]);
  });

  for (const fixture of cases) {
    test(`${fixture.id} compila, monta, audita e aceita interação segura`, async ({ page }) => {
      test.setTimeout(90_000);
      await assertRuntime(page, fixture);
    });
  }
});
