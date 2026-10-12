import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

// Start server and browser in the same execution environment. No real accounts
// or customer data are used: this route exists only in E2E_TEST_MODE.
const project = path.resolve(process.argv[2] || ".");
const output = path.resolve(process.argv[3] || "artifacts/studio-styles");
const port = process.env.STUDIO_STYLE_PORT || "3100";
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.join(project, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", port], {
  cwd: project,
  env: {
    ...process.env, E2E_TEST_MODE: "1",
    // Public screens initialize their auth client. These non-working values
    // keep screenshots independent of real accounts, credentials and data.
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "studio-visual-test-not-a-real-key",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
let exited = false;
for (const stream of [server.stdout, server.stderr]) stream.on("data", (data) => { serverLog = (serverLog + data).slice(-8000); });
server.on("exit", () => { exited = true; });
const url = `${origin}/e2e-runtime/styles`;
let browser;
try {
  const deadline = Date.now() + 120000;
  let ready = false;
  while (Date.now() < deadline && !exited) {
    try { ready = (await fetch(url, { signal: AbortSignal.timeout(5000) })).ok; } catch { /* compiling */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error(`Servidor não abriu a fixture. ${serverLog}`);
  browser = await chromium.launch({ headless: true });
  await fs.mkdir(output, { recursive: true });
  const snapshots = {};
  for (const [size, viewport] of Object.entries({ mobile: { width: 390, height: 844 }, desktop: { width: 1440, height: 1000 }, wide: { width: 1920, height: 1080 } })) {
    const page = await browser.newPage({ viewport, reducedMotion: "reduce", deviceScaleFactor: 1 });
    await page.goto(url);
    await page.getByText("Identidade e publicação", { exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: "*,::before,::after { animation:none!important; transition:none!important; caret-color:transparent!important; }" });
    for (const theme of ["light", "dark"]) {
      await page.getByRole("button", { name: theme === "light" ? "Tema claro" : "Tema escuro" }).click();
      await page.waitForFunction((value) => document.documentElement.classList.contains(value), theme);
      const name = `${size}-${theme}`;
      snapshots[name] = await page.evaluate(() => {
        const result = { overflow: document.documentElement.scrollWidth - innerWidth };
        const rgba = (value) => {
          const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
          const ctx = canvas.getContext("2d"); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
          return [...ctx.getImageData(0, 0, 1, 1).data];
        };
        for (const id of ["style-container", "style-header", "style-card", "style-input", "style-primary", "style-gradient"]) {
          const node = document.querySelector(`[data-testid="${id}"]`);
          const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
          result[id] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
            background: rgba(style.backgroundColor), color: rgba(style.color), border: rgba(style.borderColor),
            borderWidth: style.borderTopWidth, radius: style.borderRadius, padding: style.padding,
            fontSize: style.fontSize, lineHeight: style.lineHeight, cursor: style.cursor };
        }
        return result;
      });
      await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true, animations: "disabled" });
      await page.getByRole("button", { name: "Revisar publicação" }).click();
      await page.getByRole("dialog").waitFor();
      snapshots[name].dialog = await page.getByRole("dialog").evaluate((node) => {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return { x: box.x, y: box.y, width: box.width, height: box.height, padding: style.padding, radius: style.borderRadius };
      });
      await page.screenshot({ path: path.join(output, `${name}-dialog.png`), animations: "disabled" });
      await page.getByRole("button", { name: "Fechar", exact: true }).click();
      console.log(`CAPTURE ${name} overflow=${snapshots[name].overflow}`);
    }
    // Capture real public screens too, with no signed-in account or paid calls.
    if (size !== "wide") {
      for (const [screen, route] of [["home", "/"], ["login", "/login"]]) {
        const response = await page.goto(`${origin}${route}`);
        if (!response?.ok()) throw new Error(`Página ${route} respondeu ${response?.status()}`);
        if (screen === "login") await page.getByLabel("Email", { exact: true }).waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.addStyleTag({ content: "*,::before,::after { animation:none!important; transition:none!important; caret-color:transparent!important; }" });
        for (const theme of ["light", "dark"]) {
          await page.evaluate((value) => { document.documentElement.classList.remove("light", "dark"); document.documentElement.classList.add(value); }, theme);
          await page.screenshot({ path: path.join(output, `${screen}-${size}-${theme}.png`), fullPage: true, animations: "disabled" });
        }
      }
    }
    await page.close();
  }
  await fs.writeFile(path.join(output, "metrics.json"), JSON.stringify(snapshots, null, 2));
} catch (error) {
  console.error(serverLog);
  throw error;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
