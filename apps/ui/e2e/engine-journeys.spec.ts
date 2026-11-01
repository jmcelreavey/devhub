import { test, expect } from "@playwright/test";

test.describe("external links", () => {
  test("target=_blank links declare an external URL the shell can intercept", async ({ page }) => {
    /**
     * The Tauri shell opens non-DevHub URLs in the system browser and rejects
     * unexpected in-window navigation. That interception keys off real
     * absolute hrefs, so this asserts the app emits them rather than
     * router-pushing to an off-origin path — which the shell could not tell
     * apart from a normal navigation.
     */
    await page.goto("/");
    await expect(page.getByRole("button", { name: /search everything/i })).toBeEnabled({
      timeout: 30_000,
    });
    await page.waitForFunction(() => document.readyState === "complete");

    const externals = await page.evaluate(() => {
      const out: { href: string; target: string; rel: string }[] = [];
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const href = a.getAttribute("href") ?? "";
        if (!/^https?:\/\//i.test(href)) continue;
        if (href.startsWith(window.location.origin)) continue;
        out.push({
          href,
          target: a.getAttribute("target") ?? "",
          rel: a.getAttribute("rel") ?? "",
        });
      }
      return out;
    });

    test.skip(externals.length === 0, "no external links on this page in this environment");
    for (const link of externals) {
      expect(link.target, `${link.href} should open out of the app window`).toBe("_blank");
      expect(link.rel, `${link.href} should not leak window.opener`).toContain("noopener");
    }
  });
});
