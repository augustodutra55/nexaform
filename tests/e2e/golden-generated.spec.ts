import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { formatGoldenBackendError } from "../../src/lib/golden-backend-error";

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
function backendProvisioningApp(fixture: GoldenFixture) {
  const source = appSource(fixture);
  const collections = manifestCollections(fixture).map((collection) => collection.name);
  const legacyReads = collections.filter((collection) =>
    new RegExp(`(?:window\\.)?AD\\.(?:query|select|find)\\(\\s*["']${collection}["']`).test(source)
  );
  const legacyDeletes = collections.filter((collection) =>
    new RegExp(`(?:window\\.)?AD\\.delete\\(\\s*["']${collection}["']`).test(source)
  );
  if (!legacyReads.length && !legacyDeletes.length) return fixture.app;
  return {
    ...fixture.app,
    files: [
      ...(fixture.app.files || []),
      {
        path: "__golden_backend_read_compat.js",
        content: [
          ...legacyReads.map((collection) => `AD.list('${collection}')`),
          ...legacyDeletes.map((collection) => `AD.list('${collection}'); AD.remove('golden-probe')`),
        ].join("; "),
      },
    ],
  };
}
function supportsCollectionDelete(fixture: GoldenFixture, collection: string): boolean {
  const escaped = collection.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const collectionUse = new RegExp(`(?:window\\.)?AD\\.(?:list|query|select|get|count|insert)\\(\\s*["']${escaped}["']`);
  return (fixture.app.files || [{ path: "App.jsx", content: fixture.app.code || "" }]).some((file) =>
    collectionUse.test(file.content) && /(?:window\.)?AD\.(?:remove|delete)\s*\(/.test(file.content)
  );
}

function crudTarget(
  fixture: GoldenFixture,
  authenticatedUserId: string
): { collection: string; data: Record<string, unknown>; updateData: Record<string, unknown>; deleteExpected: boolean } {
  const candidates = manifestCollections(fixture).filter((collection) => {
    const profile = collection.profile || collection.access;
    const authenticated = profile === "authenticated"
      || Object.values(collection.permissions || {}).some((value) => value === "authenticated");
    return authenticated && !fieldsOf(collection).some((field) => field.required && field.reference?.collection);
  });
  const selected = candidates[0];
  if (!selected?.name) throw new Error("O app agenda não declarou uma coleção autenticada sem dependência para o CRUD Golden.");
  const suffix = String(Date.now()).slice(-8);
  const data: Record<string, unknown> = {};
  for (const field of fieldsOf(selected)) {
    if (!field.required && !field.unique && !/name|nome|title|titulo/i.test(field.name)) continue;
    if (/^(?:user|owner|account)(?:id)?$/i.test(field.name)) data[field.name] = authenticatedUserId;
    else if (field.type === "uuid") data[field.name] = crypto.randomUUID();
    else if (field.type === "number" || field.type === "integer") data[field.name] = 1;
    else if (field.type === "boolean") data[field.name] = true;
    else if (field.type === "array" || (field.type === "json" && /items|itens|lista/i.test(field.name))) data[field.name] = [];
    else if (field.type === "object" || field.type === "json") data[field.name] = {};
    else if (field.type === "date" || /date|data|birth/i.test(field.name)) data[field.name] = "2026-08-27";
    else if (field.type === "email" || /email/i.test(field.name)) data[field.name] = `crud.${suffix}@example.com`;
    else if (/cpf/i.test(field.name)) data[field.name] = `987${suffix}`.slice(0, 11).padEnd(11, "0");
    else if (/phone|telefone|celular/i.test(field.name)) data[field.name] = "11999990000";
    else data[field.name] = `Paciente Golden ${suffix}`;
  }
  if (!Object.keys(data).length) data.name = `Paciente Golden ${suffix}`;
  const mutableField = fieldsOf(selected).find((field) =>
    Object.prototype.hasOwnProperty.call(data, field.name)
      && (!field.type || field.type === "string")
      && !field.unique
      && !/email|uuid|date|data|userId|ownerId/i.test(field.name)
  );
  const updateData = mutableField
    ? { [mutableField.name]: `${data[mutableField.name]} atualizado` }
    : {};
  return { collection: selected.name, data, updateData, deleteExpected: supportsCollectionDelete(fixture, selected.name) };
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
    body: JSON.stringify({ apply: true, force: true, allowDestructive: true, app: backendProvisioningApp(fixture) }),
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
    if (!/^\/api\/(?:app-auth|app-settings|data)\//.test(requestUrl.pathname)) {
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

async function fillRemainingSignupFields(submit: Locator) {
  const form = submit.locator("xpath=ancestor::form[1]");
  const inputs = form.locator("input:visible");
  for (let index = 0; index < await inputs.count(); index += 1) {
    const input = inputs.nth(index);
    if (await input.inputValue()) continue;
    const type = ((await input.getAttribute("type")) || "text").toLowerCase();
    if (["hidden", "submit", "button", "file", "image", "reset", "email", "password"].includes(type)) continue;
    if (type === "checkbox" || type === "radio") {
      if (await input.getAttribute("required")) await input.check();
      continue;
    }
    const identity = `${await input.getAttribute("name") || ""} ${await input.getAttribute("placeholder") || ""}`;
    if (type === "tel" || /phone|telefone|celular/i.test(identity)) await input.fill("11999990000");
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

async function assertAuthAndCrud(page: Page, fixture: GoldenFixture) {
  const frame = page.frameLocator('iframe[title="Preview do app"]');
  const body = frame.locator("body");
  const before = await body.innerText();
  const switcher = frame.locator("button:visible, a:visible").filter({
    hasText: /n[aã]o (?:tenho|tem|possui)(?: uma)? conta|criar (?:conta|nova|agora|minha conta)|cadastre-se|cadastrar|registro/i,
  }).first();
  await expect(switcher, `O app ${fixture.id} precisa oferecer criação de conta`).toBeVisible();
  await switcher.click();

  const submit = frame.locator('button[type="submit"]:visible, form button:visible').filter({
    hasText: /criar|cadastrar|registrar/i,
  }).first();
  await expect(submit, "O cadastro precisa substituir Entrar por uma ação explícita de criação").toBeVisible();

  const emailInputs = frame.locator(
    'input[type="email"]:visible, input[name*="email" i]:visible, input[placeholder*="email" i]:visible, input[placeholder*="e-mail" i]:visible'
  );
  const passwordInputs = frame.locator(
    'input[type="password"]:visible, input[name*="senha" i]:visible, input[name*="password" i]:visible, input[placeholder*="senha" i]:visible'
  );
  await expect(emailInputs.first(), `O app ${fixture.id} precisa expor e-mail no cadastro`).toBeVisible();
  await expect(passwordInputs.first(), `O app ${fixture.id} precisa expor senha no cadastro`).toBeVisible();
  const nameInputs = frame.locator(
    'input[name*="name" i]:visible, input[name*="nome" i]:visible, input[placeholder*="nome" i]:visible'
  );
  for (let index = 0; index < await nameInputs.count(); index += 1) {
    await nameInputs.nth(index).fill("Paciente Golden");
  }
  const uniqueEmail = `golden.${fixture.id}.${Date.now()}@example.com`;
  for (let index = 0; index < await emailInputs.count(); index += 1) {
    await emailInputs.nth(index).fill(uniqueEmail);
  }
  for (let index = 0; index < await passwordInputs.count(); index += 1) {
    await passwordInputs.nth(index).fill("Golden-Flow-2026!");
  }
  await fillRemainingSignupFields(submit);
  const signupResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "POST" && /\/api\/app-auth\//.test(url.pathname);
  }, { timeout: 30_000 });
  await submit.click();

  const signupResponse = await signupResponsePromise;
  const signupPayload = await signupResponse.json().catch(() => ({}));
  const signupRequestPayload = signupResponse.request().postDataJSON?.() || {};
  const submittedEmail = typeof signupRequestPayload?.email === "string"
    ? signupRequestPayload.email
    : "(ausente)";
  const signupCallIndex = appSource(fixture).indexOf("auth.signUp");
  const signupCall = signupCallIndex >= 0
    ? appSource(fixture).slice(Math.max(0, signupCallIndex - 120), signupCallIndex + 320).replace(/\s+/g, " ")
    : "(chamada não localizada)";
  expect(
    signupResponse.ok(),
    `O cadastro real falhou (HTTP ${signupResponse.status()}): ${formatGoldenBackendError(signupPayload, signupResponse.status())}; email enviado: ${submittedEmail}; chamada: ${signupCall}`
  ).toBeTruthy();
  expect(signupPayload?.user?.id, "O backend de cadastro precisa devolver o usuário criado").toBeTruthy();

  await expect.poll(async () => body.innerText(), { timeout: 20_000, message: "O cadastro precisa abrir o aplicativo" })
    .not.toBe(before);
  await expect.poll(async () => body.evaluate(async () => {
    const ad = (window as any).AD;
    const authenticated = ad?.auth?.me ? await ad.auth.me() : null;
    return authenticated?.id || null;
  }), { timeout: 30_000, message: "A interface de cadastro precisa manter uma sessão real" }).toBeTruthy();

  const target = crudTarget(fixture, String(signupPayload.user.id));
  const crud = await body.evaluate(async (_body, input) => {
    const ad = (window as any).AD;
    const created = await ad.insert(input.collection, input.data);
    const listed = await ad.list(input.collection);
    const found = listed.some((item: any) => item.id === created.id);
    const changedData = input.updateData;
    const updated = await ad.update(created.id, changedData);
    const afterUpdate = await ad.list(input.collection);
    const updatedPersisted = afterUpdate.some((item: any) =>
      item.id === created.id && Object.entries(changedData).every(([key, value]) => item[key] === value)
    );
    let removed = false;
    let deleteStatus = null;
    try {
      await ad.remove(created.id);
      const afterDelete = await ad.list(input.collection);
      removed = !afterDelete.some((item: any) => item.id === created.id);
    } catch (error: any) {
      deleteStatus = Number(error?.status) || null;
    }
    return { createdId: created.id, found, updatedId: updated.id, updatedPersisted, removed, deleteStatus };
  }, target);
  expect(crud).toMatchObject({ found: true, updatedPersisted: true });
  expect(crud.createdId).toBe(crud.updatedId);
  if (target.deleteExpected) expect(crud.removed, "A exclusão declarada pelo app precisa funcionar").toBe(true);
  else expect(crud.deleteStatus, "Coleção sem exclusão declarada precisa preservar o registro").toBe(403);
}

async function assertRuntime(page: Page, fixture: GoldenFixture) {
  if (manifestCollections(fixture).length > 0) await provisionGoldenBackend(fixture);
  await installGoldenBackendProxy(page);
  await page.goto(`/e2e-runtime/golden?id=${encodeURIComponent(fixture.id)}`);
  await expect(page.getByTestId("golden-case")).toHaveText(fixture.id);
  await expect(page.getByTestId("golden-runtime-ready")).toBeAttached({ timeout: 45_000 });
  await expect(page.getByTestId("golden-runtime-error")).toHaveCount(0);
  await expect(page.getByTestId("golden-runtime-audit")).toHaveText("0:0");
  // O gate só marca o preview como pronto depois de executar o smoke seguro.
  // Campos editáveis sozinhos são apenas transporte. Para apps sem login,
  // exigimos mudança de tela; a agenda passa por cadastro + CRUD logo abaixo.
  const smoke = page.getByTestId("golden-runtime-smoke");
  await expect(smoke).toHaveText(/^\d+:\d+:\d+:\d+$/, { timeout: 15_000 });
  const [attempted, changed, fieldsAttempted, fieldsEditable] = (await smoke.innerText())
    .split(":")
    .map(Number);
  expect(changed).toBeLessThanOrEqual(attempted);
  expect(fieldsEditable).toBe(fieldsAttempted);
  const frame = page.frameLocator('iframe[title="Preview do app"]');
  const hasAuthWall = await frame.locator('input[type="password"]:visible').count() > 0;
  if (hasAuthWall) {
    expect(fieldsEditable).toBeGreaterThan(0);
    expect(manifestCollections(fixture).length, `O app ${fixture.id} exige login, mas não declarou backend`).toBeGreaterThan(0);
    await assertAuthAndCrud(page, fixture);
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
