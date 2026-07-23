import { expect, test, type FrameLocator, type Page } from "@playwright/test";

function generatedApp(page: Page): FrameLocator {
  return page.frameLocator('iframe[title="Preview do app"]');
}

async function signIn(page: Page) {
  const app = generatedApp(page);
  await app.getByTestId("login-email").fill("qa@adstudio.com.br");
  await app.getByTestId("login-password").fill("senha-segura");
  await app.getByRole("button", { name: "Entrar" }).click();
  await expect(app.getByTestId("dashboard-screen")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/e2e-runtime");
  await expect(generatedApp(page).getByRole("heading", { name: "Acesse sua operação" })).toBeVisible();
});

test("percorre login, menus, formulário, CRUD, navegação e saída", async ({ page }) => {
  const app = generatedApp(page);

  await app.getByTestId("login-email").fill("email-invalido");
  await app.getByTestId("login-password").fill("curta");
  await app.getByRole("button", { name: "Entrar" }).click();
  await expect(app.getByRole("alert")).toContainText("e-mail válido");

  await signIn(page);
  await app.getByRole("button", { name: "Produtos" }).click();
  await expect(app.getByTestId("products-screen")).toBeVisible();

  await app.getByTestId("product-name").fill("Plano Enterprise");
  await app.getByTestId("product-price").fill("499,90");
  await app.getByRole("button", { name: "Adicionar produto" }).click();
  await expect(app.getByRole("heading", { name: "Plano Enterprise" })).toBeVisible();

  await app.getByRole("button", { name: "Editar Plano Enterprise" }).click();
  await app.getByTestId("product-name").fill("Plano Enterprise Plus");
  await app.getByRole("button", { name: "Salvar edição" }).click();
  await expect(app.getByRole("heading", { name: "Plano Enterprise Plus" })).toBeVisible();

  await app.getByRole("button", { name: "Excluir Plano Enterprise Plus" }).click();
  await expect(app.getByRole("heading", { name: "Plano Enterprise Plus" })).toHaveCount(0);

  await app.getByRole("button", { name: "Clientes" }).click();
  await expect(app.getByTestId("clients-screen")).toBeVisible();
  await expect(app.getByText("Marina Costa")).toBeVisible();

  await app.getByRole("button", { name: "Painel" }).click();
  await expect(app.getByTestId("dashboard-screen")).toBeVisible();
  await app.getByRole("button", { name: "Sair" }).click();
  await expect(app.getByTestId("login-screen")).toBeVisible();

  await expect(page.getByTestId("runtime-ready")).toBeAttached();
  await expect(page.getByTestId("runtime-error")).toHaveCount(0);
});

test("mantém o fluxo utilizável e sem overflow no modo mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  const app = generatedApp(page);
  await app.getByRole("button", { name: "Produtos" }).click();
  await app.getByTestId("product-name").fill("Plano Mobile");
  await app.getByTestId("product-price").fill("79,90");
  await app.getByRole("button", { name: "Adicionar produto" }).click();
  await expect(app.getByRole("heading", { name: "Plano Mobile" })).toBeVisible();

  const overflow = await app.locator("html").evaluate((html) => html.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(8);
  await expect(page.getByTestId("runtime-error")).toHaveCount(0);
});

test("seleciona um elemento real do preview e o devolve ao editor", async ({ page }) => {
  await page.getByRole("button", { name: "Selecionar elemento no preview" }).click();
  await generatedApp(page).getByRole("button", { name: "Entrar" }).click();

  await expect(page.getByTestId("visual-selection-result")).toHaveText("Entrar");
  await expect(page.getByRole("button", { name: "Selecionar elemento no preview" })).toBeVisible();
  await expect(page.getByTestId("runtime-error")).toHaveCount(0);
});
