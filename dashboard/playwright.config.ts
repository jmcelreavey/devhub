import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke journeys — the only tests in this repo that actually render a page.
 *
 * Everything else (lint, tsc, 991 vitest tests) can pass on a dashboard that
 * throws on mount, because nothing in that pipeline mounts a component: there
 * are 2 component tests for 185 components and the vitest environment is
 * `node`. These fill exactly that gap and are deliberately shallow — boot the
 * app, visit the main routes, assert no console errors. Depth belongs in unit
 * tests; this is the smoke alarm.
 *
 * Run against an already-running dashboard with:
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:1337 npx playwright test
 * Otherwise it builds and starts one itself (what CI does).
 */
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 1337);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/** Reuse whatever is already listening locally; CI always starts its own. */
const useExternalServer = Boolean(process.env.PLAYWRIGHT_BASE_URL);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  ...(useExternalServer
    ? {}
    : {
        webServer: {
          // `start:next` only, not `start` — the peer services (OpenChamber,
          // OpenCode, PTY, LAN proxy) are not needed to render pages and would
          // make CI depend on binaries that aren't there.
          command: "npm run start:next",
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          stdout: "pipe",
          stderr: "pipe",
        },
      }),
});
