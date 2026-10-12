import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }, { width: 1920, height: 1080 }]) {
  test(`preserva tema, campos, abas e diálogo em ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/e2e-runtime/styles");
    await expect(page.getByText("Identidade e publicação", { exact: true })).toBeVisible();
    for (const theme of ["light", "dark"]) {
      await page.getByRole("button", { name: theme === "light" ? "Tema claro" : "Tema escuro" }).click();
      await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
      const metrics = await page.evaluate(() => {
        const input = document.querySelector('[data-testid="style-input"]')!;
        const contact = document.querySelector('[data-testid="style-contact-input"]')!;
        const card = document.querySelector('[data-testid="style-card"]')!;
        const button = document.querySelector('[data-testid="style-primary"]')!;
        const container = document.querySelector('[data-testid="style-container"]')!;
        return { inputHeight: input.getBoundingClientRect().height,
          fieldSpacing: contact.getBoundingClientRect().top - input.getBoundingClientRect().top,
          cardBorder: getComputedStyle(card).borderTopWidth,
          cardRadius: getComputedStyle(card).borderRadius, buttonCursor: getComputedStyle(button).cursor,
          containerWidth: container.getBoundingClientRect().width,
          overflow: document.documentElement.scrollWidth - innerWidth };
      });
      expect(metrics.inputHeight).toBe(36);
      expect(metrics.fieldSpacing).toBe(84);
      expect(metrics.cardBorder).toBe("1px");
      expect(metrics.cardRadius).toBe("12px");
      expect(metrics.buttonCursor).toBe("pointer");
      expect(metrics.containerWidth).toBe(Math.min(viewport.width, 1200));
      expect(metrics.overflow).toBeLessThanOrEqual(1);
    }
    await page.getByRole("tab", { name: "Dados", exact: true }).click();
    await expect(page.getByText("Nenhum registro real foi carregado.")).toBeVisible();
    await page.getByRole("tab", { name: "Projeto", exact: true }).click();
    await page.getByTestId("style-input").fill("App do cliente");
    await page.getByRole("switch").click();
    await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    await page.getByRole("button", { name: "Salvar projeto", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Projeto de teste salvo.");
    await page.getByRole("button", { name: "Revisar publicação" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // The opening animation scales the dialog briefly; measure its final
    // layout after it settles, keeping the exact baseline requirement.
    await expect.poll(async () => (await dialog.boundingBox())?.height)
      .toBe(viewport.width === 390 ? 150 : 130);
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    await page.getByRole("button", { name: "Fechar", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });
}
