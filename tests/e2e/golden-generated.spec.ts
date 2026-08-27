import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

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
  const candidates = manifestCollections(fixture).filter((collection) => {
    const profile = collection.profile || collection.access;
    return profile === "authenticated" && !fieldsOf(collection).some((field) => field.required && field.reference?.collection);
  });
  const selected = candidates[0];
  if (!selected?.name) throw new Error("O app agenda não declarou uma coleção autenticada sem dependência para o CRUD Golden.");
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

async function assertAgendaAuthAndCrud(page: Page, fixture: GoldenFixture) {
  const frame = page.frameLocator('iframe[title="Preview do app"]');
  const body = frame.locator("body");
  const before = await body.innerText();
  const switcher = frame.locator("button:visible, a:visible").filter({ hasText: /criar conta|cadastre-se|cadastrar|registro/i }).first();
  if (await switcher.count()) await switcher.click();

  const email = frame.locator('input[type="email"]:visible').first();
  const password = frame.locator('input[type="password"]:visible').first();
  await expect(email, "O app agenda precisa expor e-mail no cadastro").toBeVisible();
  await expect(password, "O app agenda precisa expor senha no cadastro").toBeVisible();
  const uniqueEmail = `golden.agenda.${Date.now()}@example.com`;
  await email.fill(uniqueEmail);
  await password.fill("Golden-Flow-2026!");

  const name = frame.locator('input[name*="name" i]:visible, input[name*="nome" i]:visible, input[placeholder*="nome" i]:visible').first();
  if (await name.count()) await name.fill("Paciente Golden");
  const submit = frame.locator('button[type="submit"]:visible, form button:visible').filter({ hasText: /criar|cadastrar|registrar|entrar/i }).first();
  await expect(submit, "O cadastro precisa ter uma ação de envio real").toBeVisible();
  await submit.click();

  await expect.poll(async () => body.innerText(), { timeout: 20_000, message: "O cadastro precisa abrir o aplicativo" })
    .not.toBe(before);
  const authenticated = await body.evaluate(async () => {
    const ad = (window as any).AD;
    return ad?.auth?.me ? await ad.auth.me() : null;
  });
  expect(authenticated?.id, "A interface de cadastro precisa criar uma sessão real").toBeTruthy();

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
  if (fixture.id === "agenda") {
    expect(fieldsEditable).toBeGreaterThan(0);
    await assertAgendaAuthAndCrud(page, fixture);
  } else {
    expect(changed).toBeGreaterThan(0);
  }

  const frame = page.frameLocator('iframe[title="Preview do app"]');
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

  for (const fixture of cases) {
    test(`${fixture.id} compila, monta, audita e aceita interação segura`, async ({ page }) => {
      test.setTimeout(90_000);
      await assertRuntime(page, fixture);
    });
  }
});
