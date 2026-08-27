import { test, expect, type Route } from "@playwright/test";

type Json = Record<string, unknown>;

async function fulfillJson(route: Route, body: Json, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

const CACHED_PR_PAYLOAD = {
  configured: true,
  authored: [{ number: 1, title: "Cached PR", url: "https://github.com/o/r/pull/1", repo: "o/r" }],
  reviews: [],
  recentlyReviewed: [],
  cached: false,
};

/**
 * Feature backlog smoke with network mocks — GitHub 504, briefing digest payload.
 * Prefer production server (`npm run start:next` on :1338) — dev HMR breaks hydration in headless.
 */
test.describe("feature backlog mocks", () => {
  /**
   * Asserts the *client* half of the 504 fallback: given a `stale` payload, the
   * list keeps rendering and the warning surfaces.
   *
   * This deliberately does not claim to cover the server fallback — the route
   * is fully mocked here, so `readStaleGithubPrsListCache` never runs. That
   * half is unit-tested in `lib/github/prs-cache.test.ts`.
   */
  test("PR list renders the stale-cache warning after a GitHub timeout", async ({ page }) => {
    let refreshPass = false;
    await page.route("**/api/github/prs/skip**", async (route) => {
      await fulfillJson(route, { skipped: [] });
    });
    await page.route("**/api/github/prs", async (route) => {
      if (!refreshPass) {
        await fulfillJson(route, CACHED_PR_PAYLOAD);
        return;
      }
      await fulfillJson(route, {
        ...CACHED_PR_PAYLOAD,
        stale: true,
        warning: "Showing cached PRs — GitHub timed out.",
      });
    });

    await page.goto("/prs");
    await expect(page.getByRole("heading", { name: "Pull Requests" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Cached PR")).toBeVisible({ timeout: 15_000 });
    // The warning must not already be present, or the assertion below proves nothing.
    await expect(page.getByText(/GitHub timed out/i)).toHaveCount(0);

    await page.waitForFunction(() => {
      const btn = document.querySelector('button[aria-label="Refresh PRs"]');
      return btn instanceof HTMLButtonElement && !btn.disabled;
    });
    refreshPass = true;
    await page.getByRole("button", { name: "Refresh PRs" }).click();

    // Only the warning. `Cached PR` was on screen before the click, so an
    // `or`-ed assertion here passed whether or not the fallback ever rendered.
    await expect(page.getByText(/GitHub timed out/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Cached PR")).toBeVisible();
  });

  test("radar renders owned-repo attention rows from the personal API", async ({ page }) => {
    test.setTimeout(60_000);
    await page.route("**/api/radar/personal", async (route) => {
      await fulfillJson(route, {
        path: "radar/personal.md",
        exists: true,
        items: [],
        markdown: "",
        ownedRepoAttention: [
          {
            repo: { fullName: "org/widgets" },
            attention: { score: 8, reasons: ["3 unpushed commits", "missing README"] },
          },
        ],
      });
    });
    await page.goto("/radar");
    await expect(page.getByText("org/widgets")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/3 unpushed commits/)).toBeVisible();
  });

  test("workspace tabs visible on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/repos");
    await expect(page.locator(".workspace-tabs")).toBeVisible({ timeout: 60_000 });
  });
});
