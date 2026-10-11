import { test, expect } from "@playwright/test";
import { auditTopbar } from "./topbar-audit";

/**
 * The top bar once held every control on one row and clipped "Recent" to
 * "Rece" at laptop widths. Nothing else here renders it at a real size, so this
 * measures it: no overlap, no cut-off text, no target under 32px, at every
 * width from 900 up, in both shipped themes and both modes.
 */
const WIDTHS = [900, 1024, 1280, 1440, 1920] as const;
const THEMES = [
  { preset: "graphite", mode: "dark" },
  { preset: "graphite", mode: "light" },
  { preset: "hollow", mode: "dark" },
  { preset: "hollow", mode: "light" },
] as const;
// Library has five tabs, System seven: the worst case for the strip.
const ROUTES = ["/notes", "/status"] as const;

test.describe("top bar layout", () => {
  test.beforeEach(async ({ page }) => {
    // Include the gated fifth Library destination regardless of local credentials.
    await page.route("**/api/setup/status", (route) => route.fulfill({ json: { github: true } }));
  });
  for (const route of ROUTES) {
    for (const width of WIDTHS) {
      for (const theme of THEMES) {
        test(`${route} at ${width}px, ${theme.preset} ${theme.mode}`, async ({ page }) => {
          await page.setViewportSize({ width, height: 800 });
          await page.addInitScript(
            ([preset, mode]) => {
              localStorage.setItem("devhub:hollow-season", JSON.stringify({
                year: new Date().getFullYear(), previous: null, overridden: true, restored: false,
              }));
              localStorage.setItem("devhub:theme-preset", preset);
              localStorage.setItem("devhub:theme", mode);
              localStorage.setItem("sidebar-collapsed", "false");
            },
            [theme.preset, theme.mode],
          );
          await page.goto(route, { waitUntil: "domcontentloaded" });
          await expect(page.locator("header.hub-topbar")).toBeVisible();
          // Search enables once the client has mounted, i.e. the bar is final.
          await expect(page.getByRole("button", { name: /search everything/i })).toBeEnabled();

          await expect(page.locator("html")).toHaveAttribute("data-theme-preset", theme.preset);
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme.mode);
          expect(await auditTopbar(page)).toEqual([]);
          if (width >= 1440) {
            await page.keyboard.press("Tab");
            const tab = page.locator(".hub-section-tab").first();
            await tab.focus();
            await expect(tab).toBeFocused();
            await expect(tab).toHaveCSS("outline-offset", "-2px");
          }
        });
      }
    }
  }

  test("keeps labelled search discoverable on a small laptop", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto("/notes", { waitUntil: "domcontentloaded" });
    const search = page.getByRole("button", { name: /search everything/i });
    await expect(search).toBeEnabled();
    await expect(search).toHaveAttribute("aria-label", /(⌘|Ctrl\+)P\)$/);
    await expect(search.locator(".hub-search-label")).toBeVisible();
    await expect(search.locator(".hub-search-kbd")).toBeVisible();
  });

  test("active timer, pending sync and a long profile fit with either sidebar state", async ({ page }) => {
    const profile = "a-very-long-work-profile-for-test";
    await page.route("**/api/tasks/profiles", (route) => route.fulfill({
      json: { mode: "profiles", active: profile, profiles: [profile], legacyFiles: 0 },
    }));
    await page.route("**/api/status/git", (route) => route.fulfill({
      json: { dirtyCount: 4, otherDirtyCount: 2, notesCount: 2, tasksCount: 0, diagramsCount: 0, docsCount: 0, ahead: 1, behind: 0 },
    }));
    await page.addInitScript(() => {
      localStorage.setItem("devhub-focus-session", JSON.stringify({ endsAt: Date.now() + 1500000, totalMs: 1500000 }));
      localStorage.setItem("sidebar-collapsed", "false");
    });
    await page.goto("/status");
    await expect(page.locator("header.hub-topbar .focus-pill.running")).toBeVisible();
    await expect(page.locator("header.hub-topbar .hub-profile-trigger")).toHaveAttribute("aria-label", new RegExp(profile));
    for (const collapsed of [false, true]) {
      if (collapsed) await page.evaluate(() => window.dispatchEvent(new Event("sidebar:toggle")));
      for (const width of [900, 1112, 1312, 1432, 1920]) {
        await page.setViewportSize({ width, height: 800 });
        // Profile names deliberately ellipsise; their full name remains in the accessible label.
        expect((await auditTopbar(page)).filter((issue) => issue.kind !== "clipped" || !issue.detail.startsWith(profile))).toEqual([]);
      }
    }
  });

  test("Tools follows header tab order and stays anchored when resizing", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/notes", { waitUntil: "domcontentloaded" });
    const tools = page.getByRole("button", { name: "More tools" });
    // Safari honours the OS keyboard setting, which can skip plain buttons.
    // Closing the portal must continue exactly where native Tab from Tools goes.
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
    await expect(page.getByRole("menu", { name: "More tools" })).toBeHidden();
    await expect.poll(() => next!.evaluate((element) => element === document.activeElement)).toBe(true);
    await tools.click();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("menu", { name: "More tools" })).toBeHidden();
    await expect.poll(() => previous!.evaluate((element) => element === document.activeElement)).toBe(true);
    await tools.click();
    await page.setViewportSize({ width: 1920, height: 800 });
    await expect(tools).toBeVisible();
    const menuBox = await page.getByRole("menu", { name: "More tools" }).boundingBox();
    const triggerBox = await tools.boundingBox();
    expect(menuBox!.y).toBeGreaterThan(triggerBox!.y);
    expect(menuBox!.x).toBeGreaterThan(0);
    await page.evaluate(() => window.dispatchEvent(new Event("sidebar:toggle")));
    await expect.poll(async () => {
      const menu = await page.getByRole("menu", { name: "More tools" }).boundingBox();
      const trigger = await tools.boundingBox();
      return Math.abs(menu!.x + menu!.width - trigger!.x - trigger!.width);
    }).toBeLessThan(2);
    await page.keyboard.press("Escape");
    await expect(tools).toBeFocused();
  });

  test("an open section disclosure closes when its inline navigation appears", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto("/notes");
    await page.locator(".hub-section-menu-trigger").click();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator(".hub-section-menu-pop")).toHaveCount(0);
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(page.locator(".hub-section-menu-trigger")).toHaveAttribute("aria-expanded", "false");
  });

  test("Library navigation is visible at laptop width", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/notes", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".hub-section-tabs")).toBeVisible();
    await expect(page.locator(".hub-section-menu")).toBeHidden();
  });

  test("narrow bars swap the tab strip for a menu", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto("/notes", { waitUntil: "domcontentloaded" });
    const trigger = page.getByRole("button", { name: /^Section: Notes/ });
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.getByRole("link", { name: "Docs" })).toBeVisible();
  });
});
