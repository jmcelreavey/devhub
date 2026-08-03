import fs from "node:fs";
import path from "node:path";
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

/**
 * `npm run verify` builds into `.next-verify` (DEVHUB_VERIFY_BUILD=1) so it does
 * not clobber a live `next-server` `.next`. CI runs e2e right after verify, so
 * start must point at that distDir — otherwise `next start` looks for `.next`
 * and dies with production-start-no-build-id.
 */
const verifyDistReady = fs.existsSync(path.join(__dirname, ".next-verify", "BUILD_ID"));
const useVerifyDist =
  process.env.DEVHUB_VERIFY_BUILD === "1" || Boolean(process.env.CI && verifyDistReady);

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
    video: process.env.PLAYWRIGHT_VIDEO === "1" ? "on" : "off",
  },

  /**
   * WebKit is not a nice-to-have here — it is the engine the shipped desktop
   * app renders in. Tauri uses the OS webview (WKWebView on macOS,
   * WebKitGTK on Linux), so a dashboard that only works in Chromium is a
   * dashboard that does not work in the product we are about to ship.
   *
   * Playwright's WebKit is an *early signal*, not proof: it tracks upstream
   * WebKit rather than the exact WKWebView on any given macOS build. A pass
   * here means "no obvious engine-level breakage"; the Tauri harness is what
   * actually proves WKWebView.
   *
   * Run one engine with `--project=chromium` / `--project=webkit`.
   */
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],

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
          env: {
            ...process.env,
            ...(useVerifyDist ? { DEVHUB_VERIFY_BUILD: "1" } : {}),
          },
        },
      }),
});
