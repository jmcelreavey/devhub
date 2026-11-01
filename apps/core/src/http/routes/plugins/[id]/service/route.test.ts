import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { writeReviewedFixture } from "../../../../../lib/plugins/__fixtures__/same-build";
import { pluginContext } from "../../../../../lib/plugins/context";
import { reviewLocalRuntime } from "../../../../../lib/plugins/local-runtime";
import { confirmOperation, startLifecycle } from "../../../../../lib/plugins/operations";
import { reviewRuntimeService } from "../../../../../lib/plugins/runtime-supervisor";
import { GET, POST } from "./route";

let root = "";
afterEach(() => {
  vi.unstubAllEnvs();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

it("rejects approval of a replaced service snapshot and accepts its current digest", async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "service-route-")));
  vi.stubEnv("HOME", root);
  vi.stubEnv("DEVHUB_CONFIG_DIR", path.join(root, "config"));
  vi.stubEnv("DEVHUB_PLUGIN_HOME", path.join(root, "plugins"));
  vi.stubEnv("DEVHUB_PLUGIN_TARGET_HOME", path.join(root, "targets"));
  vi.stubEnv("DEVHUB_BIND_HOST", "127.0.0.1");
  vi.stubEnv("DEVHUB_LAN_PROXY_HOST", "");
  vi.stubEnv("DEVHUB_BOOTSTRAP_TOKEN", "");
  const ctx = pluginContext();
  const source = path.join(root, "source");
  const fixture = writeReviewedFixture(source, "service");
  async function install() {
    const review = await reviewLocalRuntime(ctx, source);
    await reviewLocalRuntime(ctx, source, review.preview.planDigest);
  }
  await install();
  const endpoint = "http://localhost:7437/api/plugins/fixture-service/service";
  const headers = { host: "localhost:7437", origin: "http://localhost:7437", "sec-fetch-site": "same-origin", "content-type": "application/json" };
  const routeContext = { params: Promise.resolve({ id: "fixture-service" }) };
  const review = async () => {
    const response = await GET(new Request(endpoint, { headers }), routeContext);
    expect(response.status).toBe(200);
    return response.json();
  };
  const change = (body: unknown, requestHeaders: Record<string, string> = headers) => POST(new Request(endpoint, { method: "POST", headers: requestHeaders, body: JSON.stringify(body) }), routeContext);
  const original = await review();
  expect(original).toMatchObject({ label: "Fixture service", maxRunSeconds: 30, enabled: false });
  expect(original.inventory.map((group: { kind: string }) => group.kind)).toContain("Network access (declared, not enforced)");
  fixture.update();
  await install();
  const stale = await change({ action: "approve", digest: original.digest });
  expect(stale.status).toBe(409);
  expect((await stale.json()).error.code).toBe("SERVICE_CHANGED");
  expect(reviewRuntimeService(ctx, "fixture-service").enabled).toBe(false);
  const current = await review();
  expect(current.digest).not.toBe(original.digest);
  const scripted = await change({ action: "approve", digest: current.digest }, { ...headers, "x-devhub-secret": "fixture-secret" });
  expect(scripted.status).toBe(403);
  expect((await change({ action: "approve", digest: current.digest })).status).toBe(200);
  const approved = reviewRuntimeService(ctx, "fixture-service");
  expect(approved.enabled).toBe(true);
  const disabled = await startLifecycle(ctx, "fixture-service", "disable");
  if (!disabled.preview) throw new Error("Missing disable review");
  const result = await confirmOperation(ctx, disabled.id, { accepted: true, revision: disabled.preview.revision, planDigest: disabled.preview.planDigest, selectedTargets: [] });
  expect(result.state).toBe("succeeded");
  const consentFile = path.join(ctx.paths.configDir, "runtime-services", `${approved.plugin.id}.json`);
  expect(fs.existsSync(consentFile)).toBe(true);
  expect((await change({ action: "disable" })).status).toBe(200);
  expect(fs.existsSync(consentFile)).toBe(false);
}, 30000);
