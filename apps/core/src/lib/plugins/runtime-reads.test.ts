import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { runtimeSchema, type RuntimeContribution } from "../../../../../packages/shared/ui-lib/plugins/runtime-contract";
import { prepareRuntimeReads, type RuntimeReadProviders } from "./runtime-reads";
import { pluginContext } from "./context";
import { prepareLocal, confirmOperation, startLifecycle } from "./operations";
import { invokeRuntime, loadRuntime } from "./runtime-host";

const native = vi.hoisted(() => ({ github: vi.fn() }));
vi.mock("../github/prs", () => ({ fetchMyGithubPrs: native.github }));

const runtime: RuntimeContribution = {
  api: "1", transport: "request-worker", entry: "worker.mjs", sha256: "a".repeat(64),
  lockfile: { path: "package-lock.json", sha256: "b".repeat(64) }, pages: [], mcp: [],
  routes: [{ path: "/evidence", method: "GET" }],
  capabilities: { reads: [{ path: "/evidence", sources: ["github.prs", "jira.issues", "datadog.alerts"] }] },
  permissions: { env: [], network: [], exec: false },
};
const request = { kind: "api" as const, path: "/evidence", method: "GET" };
const pr = { number: 1, title: "Kept work", repo: "fixture/repo", url: "https://example.test/pr/1", updatedAt: "2026-10-28" };
const readers = () => ({
  "github.prs": vi.fn(async () => ({ authored: [{ ...pr, credentials: "must stay in host" }], reviews: [] })),
  "jira.issues": vi.fn(async () => [{ key: "FIX-1", summary: "Kept issue", status: "Done", url: "https://example.test/FIX-1", updatedAt: "2026-10-28", configuration: "must stay in host" }]),
  "datadog.alerts": vi.fn(async () => ({ oncall: [{ title: "Kept alert", timestampMs: Date.parse("2026-10-28"), status: "resolved", private: "must stay in host" }], related: [] })),
});
afterEach(() => vi.unstubAllEnvs());

it("only prepares explicitly granted API GET reads", async () => {
  const sources = readers();
  for (const action of [{ ...request, path: "/other" }, { ...request, method: "POST" }, { ...request, kind: "mcp" as const }]) {
    expect(await prepareRuntimeReads(runtime, action, undefined, sources)).toBeUndefined();
  }
  expect(await prepareRuntimeReads({ ...runtime, capabilities: {} }, request, undefined, sources)).toBeUndefined();
  for (const source of Object.values(sources)) expect(source).not.toHaveBeenCalled();
  await prepareRuntimeReads({ ...runtime, capabilities: { reads: [{ path: "/evidence", sources: ["github.prs"] }] } }, request, undefined, sources);
  expect(sources["github.prs"]).toHaveBeenCalledOnce();
  expect(sources["jira.issues"]).not.toHaveBeenCalled();
  expect(sources["datadog.alerts"]).not.toHaveBeenCalled();
});

it("retains work metadata and strips provider configuration and unexpected fields", async () => {
  vi.stubEnv("DEVHUB_BASE_URL", "http://127.0.0.1:1437");
  const snapshot = await prepareRuntimeReads(runtime, request, undefined, readers());
  expect(snapshot).toMatchObject({ version: "1", origin: "http://127.0.0.1:1437", sources: { "github.prs": { authored: [pr], reviews: [] } } });
  expect(JSON.stringify(snapshot)).not.toMatch(/credentials|configuration|private|must stay/);
});

it("keeps partial results without forwarding source errors or invalid/oversized records", async () => {
  const sources: RuntimeReadProviders = {
    "github.prs": async () => { throw new Error("private account error"); },
    "jira.issues": async () => [{ summary: "invalid" }],
    "datadog.alerts": async () => ({ oncall: Array.from({ length: 21 }, () => ({ title: "too many", timestampMs: 1 })), related: [] }),
  };
  expect((await prepareRuntimeReads(runtime, request, undefined, sources))?.sources).toEqual({ "github.prs": null, "jira.issues": null, "datadog.alerts": null });
});

it("does not return a snapshot when the caller cancels pending reads", async () => {
  const controller = new AbortController();
  const pending = () => new Promise<never>(() => {});
  const call = prepareRuntimeReads(runtime, request, controller.signal, { "github.prs": pending, "jira.issues": pending, "datadog.alerts": pending });
  controller.abort();
  await expect(call).rejects.toThrow("cancelled");
});

it.each([
  { reads: [{ path: "/other", sources: ["github.prs"] }] },
  { reads: [{ path: "/evidence", sources: ["credentials"] }] },
  { reads: [{ path: "/evidence", sources: ["jira.issues", "jira.issues"] }] },
  { reads: [{ path: "/evidence", sources: ["jira.issues"] }, { path: "/evidence", sources: ["github.prs"] }] },
])("rejects unbound, unknown or duplicated read grants: %j", capabilities => {
  expect(runtimeSchema.safeParse({ ...runtime, capabilities }).success).toBe(false);
  expect(runtimeSchema.safeParse(runtime).success).toBe(true);
});

it("appends canonical reads to a restricted worker and retires a pending snapshot on disable", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "runtime-reads-")));
  let release: ((value: unknown) => void) | undefined;
  try {
    const source = path.join(root, "source");
    fs.mkdirSync(source);
    fs.copyFileSync(path.resolve("../../templates/runtime-plugin/package-lock.json"), path.join(source, "package-lock.json"));
    fs.writeFileSync(path.join(source, "worker.mjs"), `import fs from 'node:fs';const chunks=[];for await(const c of process.stdin)chunks.push(c);const req=JSON.parse(Buffer.concat(chunks));fs.appendFileSync('calls','started\\n');process.stdout.write(JSON.stringify(req.hostReads??null));`);
    const hash = (file: string) => createHash("sha256").update(fs.readFileSync(path.join(source, file))).digest("hex");
    fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify({ name: "fixture", version: "1.0.0", devhubApi: "1", contributes: {}, runtime: {
      ...runtime, sha256: hash("worker.mjs"), lockfile: { path: "package-lock.json", sha256: hash("package-lock.json") },
      capabilities: { reads: [{ path: "/evidence", sources: ["github.prs"] }] },
    } }));
    const env = { NODE_ENV: "test" as const, DEVHUB_CONFIG_DIR: path.join(root, "config"), DEVHUB_PLUGIN_HOME: path.join(root, "managed"), DEVHUB_PLUGIN_TARGET_HOME: path.join(root, "targets") };
    const ctx = pluginContext({ home: root, env });
    const review = await prepareLocal(ctx, source, { reviewRuntimeReplacement: true });
    if (!review.preview?.canApply) throw new Error(JSON.stringify(review.preview?.blockers));
    expect((await confirmOperation(ctx, review.id, { accepted: true, revision: review.preview.revision, planDigest: review.preview.planDigest, selectedTargets: [] })).state).toBe("succeeded");
    const id = loadRuntime(ctx, "fixture").id;
    native.github.mockResolvedValue({ authored: [{ ...pr, credentials: "keep in host" }], reviews: [] });
    expect(await invokeRuntime(ctx, "fixture", request)).toMatchObject({ version: "1", sources: { "github.prs": { authored: [pr], reviews: [] } } });
    const calls = path.join(env.DEVHUB_PLUGIN_HOME, "runtime-data", id, "calls");
    expect(fs.readFileSync(calls, "utf8")).toBe("started\n");
    native.github.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = invokeRuntime(ctx, "fixture", request);
    const stopped = expect(pending).rejects.toMatchObject({ code: "RUNTIME_FAILED" });
    await vi.waitFor(() => expect(release).toBeDefined());
    const disable = await startLifecycle(ctx, "fixture", "disable");
    if (!disable.preview) throw new Error("Missing disable preview");
    await confirmOperation(ctx, disable.id, { accepted: true, revision: disable.preview.revision, planDigest: disable.preview.planDigest, selectedTargets: [] });
    await stopped;
    release?.({ authored: [], reviews: [] });
    expect(fs.readFileSync(calls, "utf8")).toBe("started\n");
  } finally {
    release?.({ authored: [], reviews: [] });
    native.github.mockReset();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
