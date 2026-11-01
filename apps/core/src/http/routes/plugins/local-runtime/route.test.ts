import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { loadRuntime } from "../../../../lib/plugins/runtime-catalog";
import { pluginContext } from "../../../../lib/plugins/context";
import { POST } from "./route";

let root = "";
afterEach(() => {
  vi.unstubAllEnvs();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

it("rejects stale local runtime fingerprints and accepts the current review", async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "runtime-route-")));
  const source = path.join(root, "source");
  fs.cpSync(path.resolve("../../templates/runtime-plugin"), source, { recursive: true });
  vi.stubEnv("HOME", root);
  vi.stubEnv("DEVHUB_CONFIG_DIR", path.join(root, "config"));
  vi.stubEnv("DEVHUB_PLUGIN_HOME", path.join(root, "plugins"));
  vi.stubEnv("DEVHUB_PLUGIN_TARGET_HOME", path.join(root, "targets"));
  vi.stubEnv("DEVHUB_BIND_HOST", "127.0.0.1");
  vi.stubEnv("DEVHUB_LAN_PROXY_HOST", "");
  vi.stubEnv("DEVHUB_BOOTSTRAP_TOKEN", "");
  const forbidden = await POST(new Request("http://localhost:7437/api/plugins/local-runtime", {
    method: "POST", headers: { host: "localhost:7437", "content-type": "application/json" },
    body: JSON.stringify({ path: source }),
  }));
  expect(forbidden.status).toBe(403);
  const request = (fingerprint?: string) => POST(new Request("http://localhost:7437/api/plugins/local-runtime", {
    method: "POST", headers: { host: "localhost:7437", origin: "http://localhost:7437", "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify({ path: source, ...(fingerprint ? { fingerprint } : {}) }),
  }));
  const first = await request();
  expect(first.status).toBe(200);
  const firstReview = await first.json();
  fs.appendFileSync(path.join(source, "README.md"), "\nChanged after review.\n");
  const stale = await request(firstReview.preview.planDigest);
  expect(stale.status).toBe(409);
  const ctx = pluginContext();
  expect(fs.existsSync(ctx.paths.registryPath)).toBe(false);
  const current = await request();
  expect(current.status).toBe(200);
  const currentReview = await current.json();
  expect(currentReview.preview.planDigest).not.toBe(firstReview.preview.planDigest);
  const accepted = await request(currentReview.preview.planDigest);
  expect(accepted.status).toBe(200);
  expect(loadRuntime(ctx, "sample-tools").name).toBe("sample-tools");
}, 30000);

it("rejects scripted and cross-origin local runtime reviews before reading paths", async () => {
  vi.stubEnv("DEVHUB_API_SECRET", "fixture-api-secret");
  vi.stubEnv("DEVHUB_BIND_HOST", "127.0.0.1");
  vi.stubEnv("DEVHUB_LAN_PROXY_HOST", "");
  vi.stubEnv("DEVHUB_BOOTSTRAP_TOKEN", "");
  const callers: Record<string, string>[] = [
    { "x-devhub-secret": "fixture-api-secret" },
    { origin: "http://localhost:7437", "sec-fetch-site": "same-origin", "x-devhub-secret": "fixture-api-secret" },
    { origin: "http://localhost:7437", "x-devhub-client": "mcp" },
    { origin: "http://localhost:7437", "sec-fetch-site": "same-origin", "x-devhub-client": "mcp" },
    { origin: "https://untrusted.invalid", "sec-fetch-site": "same-origin", "x-devhub-secret": "fixture-api-secret" },
  ];
  for (const headers of callers) {
    const response = await POST(new Request("http://localhost:7437/api/plugins/local-runtime", {
      method: "POST",
      headers: { host: "localhost:7437", "content-type": "application/json", ...headers },
      body: JSON.stringify({ path: "/missing-local-runtime-review-fixture", fingerprint: "a".repeat(64) }),
    }));
    expect(response.status).toBe(403);
  }
  const browser = await POST(new Request("http://localhost:7437/api/plugins/local-runtime", {
    method: "POST",
    headers: { host: "localhost:7437", origin: "http://localhost:7437", "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify({ path: "relative/plugin" }),
  }));
  expect(browser.status).toBe(400);
  expect((await browser.json()).error.code).toBe("INVALID_BODY");
});
