import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { formatGoldenBackendError } from "../../src/lib/golden-backend-error";
import { buildBackendBlueprint } from "../../src/lib/engine/backend-blueprint";

interface GoldenFixture {
  id: string;
  name: string;
  app: {
    code?: string;
    files?: Array<{ path: string; content: string }>;
  };
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

function appSource(fixture: GoldenFixture): string {
  return fixture.app.files?.map((file) => file.content).join("\n") || fixture.app.code || "";
}

function fixtureHasSignup(fixture: GoldenFixture): boolean {
  return /\b(?:window\.)?AD\.auth\.signUp\s*\(/.test(appSource(fixture));
}

interface ManifestField {
  name: string;
  type?: string;
  required?: boolean;
  unique?: boolean;
  reference?: { collection?: string };
}

interface ManifestCollection {
  name: string;
  profile?: string;
  access?: string;
  permissions?: Record<string, string>;
  fields?: ManifestField[] | Record<string, Omit<ManifestField, "name">>;
}

function manifestCollections(fixture: GoldenFixture): ManifestCollection[] {
  for (const line of appSource(fixture).split(/\r?\n/)) {
    const marker = line.indexOf("AD_BACKEND:");
    if (marker < 0) continue;
    try {
      const parsed = JSON.parse(line.slice(marker + "AD_BACKEND:".length).trim().replace(/\*\/\s*$/, "").trim());
      if (Array.isArray(parsed?.collections)) return parsed.collections;
    } catch {}
  }
  return [];
}

function fieldsOf(collection: ManifestCollection): ManifestField[] {
  if (Array.isArray(collection.fields)) return collection.fields;
  return Object.entries(collection.fields || {}).map(([name, field]) => ({ name, ...field }));
}

function crudTarget(fixture: GoldenFixture): { collection: string; data: Record<string, unknown> } {
  const blueprint = buildBackendBlueprint(fixture.app as any);
  const fullCrud = new Set(
    blueprint.collections
      .filter((collection) =>
        collection.profile === "authenticated"
        && ["read", "insert", "update", "delete"].every((operation) =>
          collection.operations.includes(operation as "read" | "insert" | "update" | "delete")
        )
      )
      .map((collection) => collection.collection)
  );
  const candidates = manifestCollections(fixture).filter((collection) =>
    !!collection.name
    && fullCrud.has(collection.name)
    && !fieldsOf(collection).some((field) => field.required && field.reference?.collection)
  );
  const selected = candidates[0];
  if (!selected?.name) {
    throw new Error(
      "O app agenda não declarou uma coleção autenticada com leitura, criação, edição e exclusão para o CRUD Golden."
    );
  }
  const suffix = String(Date.now()).slice(-8);
  const data: Record<string, unknown> = {};
  for (const field of fieldsOf(selected)) {
    if (!field.required && !field.unique && !/name|nome|title|titulo/i.test(field.name)) continue;
    if (field.type === "number" || field.type === "integer") data[field.name] = 1;
    else if (field.type === "boolean") data[field.name] = true;
    else if (field.type === "date" || /date|data|birth/i.test(field.name)) data[field.name] = "2026-08-27";
    else if (field.type === "email" || /email/i.test(field.name)) data[field.name] = `crud.${suffix}@example.com`;
    else if (/cpf/i.test(field.name)) data[field.name] = `987${suffix}`.slice(0, 11).padEnd(11, "0");
    else if (/phone|telefone|celular/i.test(field.name)) data[field.name] = "11999990000";
    else data[field.name] = `Paciente Golden ${suffix}`;
  }
  if (!Object.keys(data).length) data.name = `Paciente Golden ${suffix}`;
  return { collection: selected.name, data };
}

function goldenServiceHeaders(secret: string) {
  const timestamp = String(Date.now());
  return {
    "x-ad-golden-timestamp": timestamp,
    "x-ad-golden-signature": crypto.createHmac("sha256", secret).update(timestamp).digest("hex"),
  };
}

async function provisionGoldenBackend(fixture: GoldenFixture) {
  const base = process.env.GOLDEN_RUNTIME_API_URL?.trim();
  const secret = process.env.AD_GOLDEN_SERVICE_SECRET?.trim();
  const projectId = process.env.AD_GOLDEN_PROJECT_ID?.trim();
  if (!base || !secret || !projectId) {
    throw new Error("Golden funcional requer URL, segredo e projeto para provisionar o backend real.");
  }
  const response = await fetch(new URL(`/api/backend/${projectId}`, base), {
    method: "POST",
    headers: { "content-type": "application/json", ...goldenServiceHeaders(secret) },
    body: JSON.stringify({ apply: true, force: true, allowDestructive: true, app: fixture.app }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.applied !== true) {
    throw new Error(formatGoldenBackendError(payload, response.status));
  }
}

async function installGoldenBackendProxy(page: Page) {
  const base = process.env.GOLDEN_RUNTIME_API_URL?.trim();
  const secret = process.env.AD_GOLDEN_SERVICE_SECRET?.trim();
  if (!base || !secret) return;

  await page.route("**/api/**", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (!/^\/api\/(?:app-auth|data)\//.test(requestUrl.pathname)) {
      await route.continue();
      return;
    }
    const headers = { ...route.request().headers() };
    delete headers.host;
    delete headers.cookie;
    Object.assign(headers, goldenServiceHeaders(secret));
    const target = new URL(requestUrl.pathname + requestUrl.search, base);
    const response = await route.fetch({ url: target.toString(), headers });
    await route.fulfill({ response });
  });
}

async function fillSignupForm(submit: Locator, email: string, password: string) {
  const form = submit.locator("xpath=ancestor::form[1]");
  const inputs = form.locator("input:visible");
  for (let index = 0; index < await inputs.count(); index += 1) {
    const input = inputs.nth(index);
    const type = ((await input.getAttribute("type")) || "text").toLowerCase();
    if (["hidden", "submit", "button", "file", "image", "reset"].includes(type)) continue;
    if (type === "checkbox" || type === "radio") {
      if (await input.getAttribute("required")) await input.check();
      continue;
    }
    if (await input.inputValue()) continue;
    const identity = `${await input.getAttribute("name") || ""} ${await input.getAttribute("placeholder") || ""}`;
    if (type === "email" || /email/i.test(identity)) await input.fill(email);
    else if (type === "password") await input.fill(password);
    else if (type === "tel" || /phone|telefone|celular/i.test(identity)) await input.fill("11999990000");
    else if (type === "number") await input.fill("1");
    else if (type === "date") await input.fill("2026-09-02");
    else if (type === "time") await input.fill("09:00");
    else if (type === "datetime-local") await input.fill("2026-09-02T09:00");
    else if (type === "url") await input.fill("https://example.com");
    else await input.fill(/clinic|clínica/i.test(identity) ? "Clínica Golden" : "Paciente Golden");
  }

  const textareas = form.locator("textarea:visible");
  for (let index = 0; index < await textareas.count(); index += 1) {
    const textarea = textareas.nth(index);
    if (!(await textarea.inputValue())) await textarea.fill("Cadastro Golden");
  }

  const selects = form.locator("select:visible");
  for (let index = 0; index < await selects.count(); index += 1) {
    const select = selects.nth(index);
    if (await select.inputValue()) continue;
    const value = await select.locator("option:not([disabled])").evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value).find(Boolean) || ""
    );
    if (value) await select.selectOption(value);
  }

  const valid = await submit.evaluate((button) =>
    (button.closest("form") as HTMLFormElement | null)?.checkValidity() ?? true
  );
  expect(valid, "O formulário de cadastro gerado precisa aceitar dados válidos").toBeTruthy();
}

async function signupAndEnter(page: Page, fixture: GoldenFixture) {
  const frame = page.frameLocator('iframe[title="Preview do app"]');
  const body = frame.locator("body");
  const before = await body.innerText();
  const switcher = frame.locator("button:visible, a:visible").filter({
    hasText: /não tem conta|criar (?:uma )?conta|criar uma|nova conta|cadastre-se|cadastrar|registro/i,
  }).first();
  if (await switcher.count()) await switcher.dispatchEvent("click");

  const email = frame.locator('input[type="email"]:visible').first();
  const password = frame.locator('input[type="password"]:visible').first();
  await expect(email, `O app ${fixture.id} precisa expor e-mail no cadastro`).toBeVisible();
  await expect(password, `O app ${fixture.id} precisa expor senha no cadastro`).toBeVisible();
  const uniqueEmail = `golden.${fixture.id}.${Date.now()}@example.com`;
  await email.fill(uniqueEmail);
  await password.fill("Golden-Flow-2026!");

  const name = frame.locator('input[name*="name" i]:visible, input[name*="nome" i]:visible, input[placeholder*="nome" i]:visible').first();
  if (await name.count()) await name.fill("Paciente Golden");
  const submit = frame.locator('button[type="submit"]:visible, form button:visible').filter({
    hasText: /criar|cadastrar|registrar|abrir conta|começar/i,
  }).first();
  await expect(submit, "O cadastro precisa ter uma ação de envio real").toBeVisible();
  await fillSignupForm(submit, uniqueEmail, "Golden-Flow-2026!");
  const signupResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "POST" && /\/api\/app-auth\//.test(url.pathname);
  }, { timeout: 30_000 });
  await submit.click();

  const signupResponse = await signupResponsePromise;
  const signupPayload = await signupResponse.json().catch(() => ({}));
  expect(
    signupResponse.ok(),
    `O cadastro real falhou (HTTP ${signupResponse.status()}): ${formatGoldenBackendError(signupPayload, signupResponse.status())}`
  ).toBeTruthy();
  expect(signupPayload?.user?.id, "O backend de cadastro precisa devolver o usuário criado").toBeTruthy();

  await expect.poll(async () => body.innerText(), { timeout: 20_000, message: "O cadastro precisa abrir o aplicativo" })
    .not.toBe(before);
  await expect.poll(async () => body.evaluate(async () => {
    const ad = (window as any).AD;
    const authenticated = ad?.auth?.me ? await ad.auth.me() : null;
    return authenticated?.id || null;
  }), { timeout: 30_000, message: "A interface de cadastro precisa manter uma sessão real" }).toBeTruthy();

  return { frame, body };
}

async function assertAuthenticatedNavigation(page: Page, fixture: GoldenFixture) {
  const { frame, body } = await signupAndEnter(page, fixture);
  const main = frame.locator("main").last();
  await expect.poll(async () => (await main.innerText()).trim(), {
    timeout: 20_000,
    message: `O app ${fixture.id} autenticado precisa concluir o carregamento da tela inicial`,
  }).not.toBe("");
  const before = await main.innerText();
  const currentHeading = (await main.locator('h1:visible, h2:visible, [role="heading"]:visible').first()
    .innerText().catch(() => "")).trim().toLowerCase();
  const controls = frame.locator('nav button:visible, nav a:visible, header button:visible, header a:visible, [role="tab"]:visible');
  let changed = false;
  for (let index = 0; index < Math.min(await controls.count(), 12); index += 1) {
    const control = controls.nth(index);
    const label = (await control.innerText().catch(() => "")).trim();
    if (label.toLowerCase() === currentHeading) continue;
    if (/excluir|remover|apagar|deletar|delete|comprar|pagar|checkout|enviar|salvar|criar|adicionar|confirmar|sair|logout|cancelar/i.test(label)) continue;
    // O editor visual mantém uma camada transparente sobre o iframe para
    // seleção de elementos. Dispare o clique DOM, como o smoke do runtime,
    // para validar o handler React sem a camada interceptar o ponteiro.
    await control.evaluate((element) => (element as HTMLElement).click());
    try {
      await expect.poll(async () => main.innerText(), { timeout: 15_000 }).not.toBe(before);
      changed = true;
      break;
    } catch {}
  }
  expect(changed, `O app ${fixture.id} autenticado precisa responder à navegação principal`).toBeTruthy();
}

async function assertAgendaAuthAndCrud(page: Page, fixture: GoldenFixture) {
  const { body } = await signupAndEnter(page, fixture);

  const target = crudTarget(fixture);
  const crud = await body.evaluate(async (_body, input) => {
    const ad = (window as any).AD;
    const created = await ad.insert(input.collection, input.data);
    const listed = await ad.list(input.collection);
    const found = listed.some((item: any) => item.id === created.id);
    const changedField = Object.keys(input.data).find((key) => typeof input.data[key] === "string");
    const updated = await ad.update(created.id, changedField ? { [changedField]: `${input.data[changedField]} atualizado` } : input.data);
    await ad.remove(created.id);
    const afterDelete = await ad.list(input.collection);
    return { createdId: created.id, found, updatedId: updated.id, removed: !afterDelete.some((item: any) => item.id === created.id) };
  }, target);
  expect(crud).toMatchObject({ found: true, removed: true });
  expect(crud.createdId).toBe(crud.updatedId);
}

async function assertRuntime(page: Page, fixture: GoldenFixture) {
  const hasSignup = fixtureHasSignup(fixture);
  // Todos os casos compartilham o projeto Golden. Reaplique o manifesto antes
  // de cada app para que um catálogo público não herde coleções privadas do
  // fixture autenticado executado anteriormente.
  await provisionGoldenBackend(fixture);
  await installGoldenBackendProxy(page);
  await page.goto(`/e2e-runtime/golden?id=${encodeURIComponent(fixture.id)}`);
  await expect(page.getByTestId("golden-case")).toHaveText(fixture.id);
  await expect(page.getByTestId("golden-runtime-ready")).toBeAttached({ timeout: 45_000 });
  await expect(page.getByTestId("golden-runtime-error")).toHaveCount(0);
  await expect(page.getByTestId("golden-runtime-audit")).toHaveText("0:0");
  // O gate só marca o preview como pronto depois de executar o smoke seguro.
  // Campos editáveis sozinhos são apenas transporte. Para apps sem login,
  // exigimos mudança no smoke; apps protegidos passam por cadastro real e
  // precisam responder à navegação já autenticada.
  const smoke = page.getByTestId("golden-runtime-smoke");
  await expect(smoke).toHaveText(/^\d+:\d+:\d+:\d+$/, { timeout: 15_000 });
  const [attempted, changed, fieldsAttempted, fieldsEditable] = (await smoke.innerText())
    .split(":")
    .map(Number);
  expect(changed).toBeLessThanOrEqual(attempted);
  expect(fieldsEditable).toBe(fieldsAttempted);
  const frame = page.frameLocator('iframe[title="Preview do app"]');
  const isAuthGate = await frame.locator('input[type="password"]:visible').count() > 0;
  if (fixture.id === "agenda") {
    expect(fieldsEditable).toBeGreaterThan(0);
    await assertAgendaAuthAndCrud(page, fixture);
  } else if (hasSignup && isAuthGate) {
    expect(fieldsEditable).toBeGreaterThan(0);
    await assertAuthenticatedNavigation(page, fixture);
  } else {
    expect(changed).toBeGreaterThan(0);
  }

  const overflow = await frame.locator("html").evaluate((html) => html.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(8);
}

test.describe("Golden 2.0 · projetos realmente gerados", () => {
  test.describe.configure({ mode: "serial" });
  const cases = fixtures();
  test.skip(cases.length === 0, "Executado somente pelo workflow Golden com artefatos reais.");

  test("recebe os cinco artefatos aprovados pelo avaliador", () => {
    expect(cases.map((item) => item.id).sort()).toEqual(["agenda", "commerce", "dashboard", "landing", "media"]);
  });

  // Autenticação e CRUD são o risco funcional mais crítico. Execute agenda
  // primeiro para que uma regressão não fique escondida atrás de landings.
  const prioritizedCases = [...cases].sort((left, right) =>
    Number(right.id === "agenda") - Number(left.id === "agenda"));

  for (const fixture of prioritizedCases) {
    test(`${fixture.id} compila, monta, audita e aceita interação segura`, async ({ page }) => {
      test.setTimeout(90_000);
      await assertRuntime(page, fixture);
    });
  }
});
