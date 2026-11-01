import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { pluginContext } from "./context";
import { confirmOperation, prepareLocal, startLifecycle } from "./operations";
import type { PluginOperationView } from "../../../../../packages/shared/ui-lib/plugins/model";
import * as runtimeCatalog from "./runtime-catalog";
import { writeReviewedFixture } from "./__fixtures__/same-build";
import { runtimeMcpAuthenticated, runtimeMcpServers } from "./runtime-mcp";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function mockCatalog() {
  vi.spyOn(runtimeCatalog, "runtimeCatalog").mockReturnValue([{ name: "sample-tools", runtime: { mcp: [{ name: "sample" }] } } as unknown as runtimeCatalog.LoadedRuntime]);
}

function consent(view: PluginOperationView) {
  if (!view.preview) throw new Error("Missing preview");
  return { accepted: true, revision: view.preview.revision, planDigest: view.preview.planDigest, selectedTargets: [] };
}

function request(token?: string, host = "127.0.0.1:1337") {
  return new Request(`http://${host}/api/plugins/runtime/sample-tools/mcp/sample`, {
    method: "POST", headers: { host, ...(token ? { "x-devhub-plugin-token": token } : {}) },
  });
}

it("authenticates only the named plugin and server without sharing the app credential", () => {
  mockCatalog();
  vi.stubEnv("DEVHUB_BOOTSTRAP_TOKEN", "test-bootstrap-credential");
  vi.stubEnv("PORT", "1337");
  const config = runtimeMcpServers()["plugin-sample-tools-sample"];
  const token = config.headers["x-devhub-plugin-token"];
  expect(config.url).toBe("http://127.0.0.1:1337/api/plugins/runtime/sample-tools/mcp/sample");
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(config)).not.toContain("test-bootstrap-credential");
  expect(runtimeMcpAuthenticated(request(token), "sample-tools", "sample")).toBe(true);
  expect(runtimeMcpAuthenticated(request(token), "other-plugin", "sample")).toBe(false);
  expect(runtimeMcpAuthenticated(request(token), "sample-tools", "other-server")).toBe(false);
  expect(runtimeMcpAuthenticated(request(token, "example.invalid"), "sample-tools", "sample")).toBe(false);
  vi.stubEnv("DEVHUB_BOOTSTRAP_TOKEN", "rotated-test-credential");
  expect(runtimeMcpAuthenticated(request(token), "sample-tools", "sample")).toBe(false);
});

it("fails closed for absent and malformed credentials", () => {
  mockCatalog();
  vi.stubEnv("DEVHUB_BOOTSTRAP_TOKEN", "test-bootstrap-credential");
  for (const value of [undefined, "short", "z".repeat(64), "a".repeat(64)]) {
    expect(runtimeMcpAuthenticated(request(value), "sample-tools", "sample")).toBe(false);
  }
  vi.stubEnv("DEVHUB_BOOTSTRAP_TOKEN", "");
  vi.stubEnv("DEVHUB_API_SECRET", "");
  expect(runtimeMcpServers()["plugin-sample-tools-sample"].headers).not.toHaveProperty("x-devhub-plugin-token");
  expect(runtimeMcpAuthenticated(request("a".repeat(64)), "sample-tools", "sample")).toBe(false);
});

it("updates the live MCP descriptor and removes it on disable and removal", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "runtime-mcp-")));
  try {
    vi.spyOn(os, "homedir").mockReturnValue(root);
    vi.stubEnv("DEVHUB_CONFIG_DIR", path.join(root, "config"));
    vi.stubEnv("DEVHUB_PLUGIN_HOME", path.join(root, "managed"));
    vi.stubEnv("DEVHUB_PLUGIN_TARGET_HOME", path.join(root, "targets"));
    vi.stubEnv("DEVHUB_BOOTSTRAP_TOKEN", "fixture-token");
    vi.stubEnv("PORT", "1437");
    const ctx = pluginContext();
    const source = path.join(root, "source");
    const candidate = writeReviewedFixture(source, "mcp");
    const install = await prepareLocal(ctx, source);
    expect((await confirmOperation(ctx, install.id, consent(install))).state).toBe("succeeded");
    const key = "plugin-fixture-mcp-sample";
    expect(runtimeMcpServers()[key]?.url).toBe("http://127.0.0.1:1437/api/plugins/runtime/fixture-mcp/mcp/sample");
    candidate.runtime.mcp[0].name = "updated";
    candidate.update();
    const update = await prepareLocal(ctx, source, { reviewRuntimeReplacement: true });
    expect((await confirmOperation(ctx, update.id, consent(update))).state).toBe("succeeded");
    expect(runtimeMcpServers()[key]).toBeUndefined();
    expect(runtimeMcpServers()["plugin-fixture-mcp-updated"]).toBeDefined();
    const disable = await startLifecycle(ctx, "fixture-mcp", "disable");
    expect((await confirmOperation(ctx, disable.id, consent(disable))).state).toBe("succeeded");
    expect(runtimeMcpServers()["plugin-fixture-mcp-updated"]).toBeUndefined();
    const remove = await startLifecycle(ctx, "fixture-mcp", "remove");
    expect((await confirmOperation(ctx, remove.id, consent(remove))).state).toBe("succeeded");
    expect(runtimeMcpServers()["plugin-fixture-mcp-updated"]).toBeUndefined();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 30000);
