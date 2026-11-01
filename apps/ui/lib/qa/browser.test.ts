import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

interface RouteFixture {
  request: () => { url: () => string; isNavigationRequest: () => boolean };
  abort: () => Promise<void>;
  continue: () => Promise<void>;
}

const hooks = vi.hoisted(() => ({
  route: undefined as undefined | ((route: RouteFixture) => Promise<void>),
  websocket: undefined as undefined | ((socket: { close: () => void }) => void),
}));

vi.mock("playwright-core", () => ({
  chromium: {
    launch: async () => ({
      newContext: async () => ({
        route: async (_pattern: string, handler: typeof hooks.route) => { hooks.route = handler; },
        routeWebSocket: async (_pattern: string, handler: typeof hooks.websocket) => { hooks.websocket = handler; },
        newPage: async () => ({ setDefaultTimeout: () => {}, setDefaultNavigationTimeout: () => {}, on: () => {}, goto: async () => {} }),
      }),
    }),
  },
}));

import { BrowserDriver } from "@devhub/qa/browser";

let outputDir: string;
beforeEach(() => { hooks.route = undefined; hooks.websocket = undefined; outputDir = mkdtempSync(path.join(tmpdir(), "qa-browser-")); });
afterEach(() => rmSync(outputDir, { recursive: true, force: true }));

it("confines managed task requests and websockets to the proxy", async () => {
  const driver = new BrowserDriver({ url: "http://127.0.0.1:40001/", outputDir, restrictToAllowedOrigins: true });
  await driver.start(new AbortController().signal);
  const abort = vi.fn(async () => {});
  const proceed = vi.fn(async () => {});
  const route = (url: string): RouteFixture => ({ request: () => ({ url: () => url, isNavigationRequest: () => false }), abort, continue: proceed });
  await hooks.route!(route("http://127.0.0.1:40002/app.js"));
  await hooks.route!(route("http://127.0.0.1:40001/app.js"));
  expect(abort).toHaveBeenCalledOnce();
  expect(proceed).toHaveBeenCalledOnce();
  const close = vi.fn();
  hooks.websocket!({ close });
  expect(close).toHaveBeenCalledOnce();
});

it("keeps manual QA's existing subresource policy", async () => {
  const driver = new BrowserDriver({ url: "http://127.0.0.1:40001/", outputDir });
  await driver.start(new AbortController().signal);
  const abort = vi.fn(async () => {});
  const proceed = vi.fn(async () => {});
  await hooks.route!({ request: () => ({ url: () => "http://127.0.0.1:40002/app.js", isNavigationRequest: () => false }), abort, continue: proceed });
  expect(proceed).toHaveBeenCalledOnce();
  expect(abort).not.toHaveBeenCalled();
  expect(hooks.websocket).toBeUndefined();
});
