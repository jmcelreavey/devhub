import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PLAYWRIGHT_PORT?.trim() || process.env.PORT?.trim() || "1437");
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/** Reuse whatever is already listening locally; CI always starts its own. */
const useExternalServer = Boolean(process.env.PLAYWRIGHT_BASE_URL);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["github"], ["list"], ["html", { open: "never" }]]
    : [["list"]],
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: process.env.PLAYWRIGHT_VIDEO === "1" ? "on" : "off",
    serviceWorkers: "block",
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
          command: "npm run start",
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          // Let the supervisor stop detached children before its process group is killed.
          gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
          stdout: "pipe",
          stderr: "pipe",
          env: {
            ...process.env,
            PORT: String(PORT),
          },
        },
      }),
});
