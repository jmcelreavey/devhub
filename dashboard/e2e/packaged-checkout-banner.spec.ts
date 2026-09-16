import { test, expect } from "@playwright/test";

test("packaged checkout stale banner", async ({ page }, testInfo) => {
  await page.route("**/api/status/packaged-checkout**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        packagedRuntime: true,
        hasCheckout: true,
        checkout: "/Users/dev/devhub",
        bundleCommit: "deadbeef00000000000000000000000000000000",
        checkoutCommit: "cafebabe00000000000000000000000000000000",
        stale: true,
        reason:
          "Your linked checkout is ahead of the dashboard baked into this app. Rebuild to copy it in, or attach to a dev server for hot reload.",
      }),
    });
  });

  // Not "networkidle": the shell keeps the /api/desktop/navigation event stream
  // open, so the network never goes idle. The banner assertion below waits.
  await page.goto("/status", { waitUntil: "domcontentloaded" });
  const banner = page.locator(".packaged-checkout-banner");
  await expect(banner).toBeVisible({ timeout: 60_000 });
  await expect(banner).toContainText("Dashboard bundle is behind your checkout");
  await expect(banner).toContainText("Rebuild Dashboard");

  // testInfo.outputPath, not a hardcoded /opt/cursor/artifacts — that path is a
  // cloud sandbox detail and made this spec fail everywhere else.
  await page.screenshot({ path: testInfo.outputPath("packaged-checkout-banner.png") });

  await banner.getByRole("button", { name: /dismiss/i }).click();
  await expect(banner).toHaveCount(0);
});
