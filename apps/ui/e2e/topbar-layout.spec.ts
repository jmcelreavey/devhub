import { test, expect } from "@playwright/test";

test.describe("top bar behavior", () => {
  test("Panels restores tab order when closed", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/notes", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /search everything/i })).toBeEnabled();
    const tools = page.getByRole("button", { name: "Panels" });
    await tools.focus();
    await page.keyboard.press("Tab");
    const next = await page.locator(":focus").elementHandle();
    await tools.focus();
    await page.keyboard.press("Shift+Tab");
    const previous = await page.locator(":focus").elementHandle();
    await tools.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: /^Notes/ })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("menu", { name: "Panels" })).toBeHidden();
    await expect.poll(() => next!.evaluate((element) => element === document.activeElement)).toBe(true);
    await tools.click();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("menu", { name: "Panels" })).toBeHidden();
    await expect.poll(() => previous!.evaluate((element) => element === document.activeElement)).toBe(true);
  });

  test("a pointer open keeps keyboard navigation working", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/notes", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /search everything/i })).toBeEnabled();
    const tools = page.getByRole("button", { name: "Panels" });
    await expect(tools).toBeVisible();
    const menu = page.getByRole("menu", { name: "Panels" });
    await tools.click();
    await expect(menu).toBeFocused();
    await expect(page.getByRole("menuitem", { name: /^Notes/ })).not.toBeFocused();
    await page.keyboard.press("ArrowDown");
    const first = page.getByRole("menuitem", { name: /^Notes/ });
    await expect(first).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(tools).toBeFocused();

    await tools.focus();
    await page.keyboard.press("Enter");
    await expect(first).toBeFocused();
  });
});
