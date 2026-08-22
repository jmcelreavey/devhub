import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";

/**
 * Routes that render their own UI. Redirect-only routes (/tasks, /activity,
 * /collections) and layout-hosted ones (/chamber, /claude, /cursor, /opencode) are
 * excluded — they have no content of their own to assert on.
 */
const ROUTES = [
  "/",
  "/briefing",
  "/work",
  "/prs",
  "/review",
  "/notes",
  "/skills",
  "/repos",
  "/status",
  "/docs",
  "/learnings",
  "/radar",
  "/research",
  "/search",
  "/diagrams",
  "/appraisal",
  "/one-on-one",
  "/shared",
  "/actions",
  "/setup",
] as const;

/**
 * Console noise we accept. Keep this list short and justified — every entry is
 * a thing we've decided not to fix, and it should read that way.
 */
const IGNORED_CONSOLE = [
  /Failed to load resource.*\b(401|403|404|429|5\d\d)\b/, // unconfigured integrations
  /\[Fast Refresh\]/,
  /Download the React DevTools/,
  /net::ERR_/, // offline third parties (avatars, feeds)
];

/**
 * Chromium logs "Failed to load resource: … 400 (Bad Request)" with no URL, so a
 * failure here used to say only that *something* on the page 4xx'd. Recording
 * every non-2xx response lets the assertion name the endpoint.
 */
function collectErrors(page: Page): { errors: string[]; badResponses: string[] } {
  const errors: string[] = [];
  const badResponses: string[] = [];
  page.on("response", (res) => {
    if (res.status() < 400) return;
    badResponses.push(`${res.status()} ${new URL(res.url()).pathname}`);
  });
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    errors.push(text);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return { errors, badResponses };
}

test.describe("routes render", () => {
  for (const route of ROUTES) {
    test(`${route} renders without console errors`, async ({ page }) => {
      const { errors, badResponses } = collectErrors(page);

      const response = await page.goto(route, { waitUntil: "domcontentloaded" });
      expect(response?.status(), `${route} should return 2xx`).toBeLessThan(400);

      // The shell is the contract: if <main> is there, the layout mounted and
      // hydration didn't blow up.
      await expect(page.locator("#main-content")).toBeAttached();
      // The timeout is the point, not a safety net. `waitForLoadState` defaults
      // to *no* timeout, so on a route that polls — /status refreshes services
      // forever — it never settles, the catch below never runs, and the test
      // dies on the 45s suite timeout with no useful message. Bounding it turns
      // "never idle" into the outcome the comment always claimed: wait a bit for
      // late fetches, then get on with the assertions.
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {
        /* long-polling routes never go idle; the assertions above are enough */
      });

      expect(
        errors,
        `console errors on ${route}${
          badResponses.length ? ` (non-2xx: ${[...new Set(badResponses)].join(", ")})` : ""
        }`,
      ).toEqual([]);
    });
  }
});

test.describe("app shell", () => {
  test("the stylesheet is actually applied", async ({ page }) => {
    /**
     * Every other test in this file passed against a build that rendered
     * completely unstyled — Times New Roman, blue underlined links, no layout.
     * A refactor had left the app's CSS compiled but unlinked, and asserting on
     * DOM presence and console errors cannot see that.
     *
     * Two cheap checks close it: a design token must resolve, and a known class
     * must produce a non-default computed style.
     */
    await page.goto("/");

    const bg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
    );
    expect(bg, "--bg design token should resolve").not.toBe("");

    // `position: fixed` on an <a> can only come from our stylesheet — an
    // unstyled anchor is `static`. Deliberately not asserting on colours: the
    // theme resolves to light in headless Chromium, where the background is
    // legitimately near-white and indistinguishable from the UA default.
    const skipLinkPosition = await page
      .locator("a.skip-link")
      .evaluate((el) => getComputedStyle(el).position);
    expect(skipLinkPosition, "app CSS should be applied").toBe("fixed");

    // The sidebar is laid out by CSS; unstyled it collapses to content width.
    const sidebarWidth = await page
      .locator("a[href='/']")
      .first()
      .evaluate((el) => el.getBoundingClientRect().width);
    expect(sidebarWidth, "nav links should be laid out, not inline text").toBeGreaterThan(60);
  });

  test("skip link is the first tab stop and moves focus to main", async ({ page }) => {
    await page.goto("/");

    await page.keyboard.press("Tab");
    const skip = page.locator("a.skip-link");
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();

    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("command palette opens on the keyboard shortcut", async ({ page }) => {
    await page.goto("/");

    // The ⌘K listener lives in a client component, so it only exists after
    // hydration. Pressing before then does nothing and the test flakes — it
    // failed roughly one run in three without this wait. Not a regression from
    // making the palette a dynamic import (the listener was always client-side
    // and still is); the shortcut simply isn't live until React has attached it.
    const searchTrigger = page.getByRole("button", { name: /search everything/i });
    await expect(searchTrigger).toBeEnabled();
    await page.waitForFunction(() => document.readyState === "complete");

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("dialog").or(page.locator("[data-command-palette]")))
      .toBeVisible({ timeout: 10_000 });
  });

  test("list rows keep their title readable on a phone", async ({ page }) => {
    /**
     * The Today review rows put the PR title in a `flex-1` (basis 0) element
     * beside a `shrink` (basis auto) repo slug. At 390px the slug took 153px of
     * 289px and the title was squeezed to 8px — one character — so the row
     * showed "acme/widgets#569" and nothing identifying.
     *
     * Asserting on rendered width rather than markup: this is a layout bug, and
     * only layout can catch it.
     */
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    // The section is data-dependent, so wait for it properly before deciding
    // it's absent — checking visibility straight after goto just races the fetch.
    const present = await page
      .getByText("Reviews owed")
      .waitFor({ timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!present, "no reviews owed in this environment");

    const title = page.locator("a.flex-1.truncate").first();
    await expect(title).toBeVisible();
    const width = await title.evaluate((el) => el.getBoundingClientRect().width);
    expect(width, "PR title should keep most of the row, not collapse").toBeGreaterThan(120);
  });

  test("navigation does not start a view transition", async ({ page }) => {
    /**
     * The inverse of the test that used to live here.
     *
     * We briefly ran experimental.viewTransition. React 19.2.4 stable exports no
     * ViewTransition component, so the React half was a passthrough that did
     * nothing, while Next's own document.startViewTransition call threw
     * "InvalidStateError: Transition was aborted because of invalid state"
     * roughly every 30 seconds in both dev and production. The old test asserted
     * startViewTransition was *called*, which stayed true the whole time the
     * feature was broken — it measured the flag, not the outcome.
     *
     * So the guard is now: navigation must complete with no view transition
     * started and no exception raised. If someone re-enables the flag, this
     * fails and they have to re-derive whether React has shipped
     * ViewTransition in stable yet.
     */
    const exceptions: string[] = [];
    page.on("pageerror", (err) => exceptions.push(String(err)));

    await page.goto("/");
    await expect(page.getByRole("button", { name: /search everything/i })).toBeEnabled();

    await page.evaluate(() => {
      const w = window as unknown as { __vt: number };
      w.__vt = 0;
      const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
      const orig = doc.startViewTransition?.bind(document);
      if (orig) {
        doc.startViewTransition = (cb: () => void) => {
          w.__vt += 1;
          return orig(cb);
        };
      }
    });

    await page.getByRole("link", { name: /^Repos/ }).click();
    await page.waitForURL("**/repos");

    const started = await page.evaluate(() => (window as unknown as { __vt: number }).__vt);
    expect(started, "no view transition should be started").toBe(0);
    expect(exceptions.join("\n"), "navigation should raise no exceptions").not.toMatch(
      /InvalidStateError/,
    );
  });

  test("sidebar exposes the primary destinations", async ({ page }) => {
    await page.goto("/");
    // Labels track the sidebar glossary (Notes / Skills — see lib/nav.ts).
    for (const label of ["Today", "Briefing", "Work", "Notes", "Skills", "Repos", "System"]) {
      await expect(page.getByRole("link", { name: label, exact: false }).first()).toBeVisible();
    }
  });
});

test.describe("api guards", () => {
  test("a mutating request with no Origin is rejected", async ({ request }) => {
    // proxy.ts enforces this globally. If this ever returns 2xx, the guard has
    // been lost — which is the whole reason it is asserted here rather than
    // trusted from a code read.
    const res = await request.post("/api/repos/clone", {
      data: { fullName: "octocat/hello-world" },
      headers: { origin: "" },
    });
    expect([401, 403]).toContain(res.status());
  });

  test("a malformed body is a 400, not a 500", async ({ request, baseURL }) => {
    const res = await request.post("/api/repos/clone", {
      data: { fullName: { not: "a string" } },
      headers: { origin: baseURL ?? "" },
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toHaveProperty("error");
  });
});
