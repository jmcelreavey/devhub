import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { startBackgroundAgent } from "../agent-runs/background";
import type { BackgroundAgentOptions } from "../agent-runs/background";
import { pluginContext } from "./context";
import { runtimeInventory, runtimeSchema } from "../../../../../packages/shared/ui-lib/plugins/runtime-contract";
import { hashFile } from "./inspect";
import { readManifest } from "./manifest";
import { confirmOperation, prepareLocal, startLifecycle } from "./operations";
import type { LoadedRuntime, RuntimeRequest } from "./runtime-host";
import { invokeRuntime } from "./runtime-host";
import { applyRuntimeAgentRun } from "./runtime-agent";

vi.mock("../agent-runs/background", () => ({ startBackgroundAgent: vi.fn() }));

function fixture() {
  const grant = {
    server: "datadog", tool: "datadog_investigate", label: "Datadog", action: "datadog",
    prompt: "Investigate the alert using the caller context.", inputKeys: ["title", "scope", "status", "tags"], titleKey: "title",
  };
  const runtime = runtimeSchema.parse({
    api: "1", transport: "request-worker", entry: "worker.mjs", sha256: "a".repeat(64),
    lockfile: { path: "package-lock.json", sha256: "b".repeat(64) }, pages: [], routes: [],
    mcp: [{ name: "datadog", description: "Fixture tools" }], capabilities: { agentRuns: [grant] },
    permissions: { env: ["DATADOG_API_KEY"], network: [], exec: false },
  });
  const plugin: LoadedRuntime = { id: "fixture", name: "fixture", root: "/fixture", revision: "a", runtime, commandDirectories: [] };
  const ctx = pluginContext({ home: "/fixture", env: { NODE_ENV: "test", DATADOG_API_KEY: "fixture-sensitive-value" } });
  const request: RuntimeRequest = {
    kind: "mcp", path: "datadog", method: "POST",
    body: { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: grant.tool, arguments: { title: "Fixture alert", scope: "oncall", tags: ["service:fixture"] } } },
  };
  const output = { jsonrpc: "2.0", id: 7, result: { content: [{ type: "text", text: "Started on __DEVHUB_AGENT_PROVIDER__ — agent run __DEVHUB_AGENT_RUN_ID__." }] }, hostAgentRun: true };
  const start = vi.fn(async () => ({ channel: "run" as const, runId: "run-fixture", providerLabel: "Fixture agent" }));
  return { grant, runtime, plugin, ctx, request, output, start };
}

it("starts only the reviewed prompt with caller context and the host notes directory", async () => {
  const { plugin, ctx, request, output, start, grant, runtime } = fixture();
  const response = await applyRuntimeAgentRun(plugin, ctx, request, output, () => true, start, () => "/fixture/notes");
  expect(response).toEqual({ jsonrpc: "2.0", id: 7, result: { content: [{ type: "text", text: "Started on Fixture agent — agent run run-fixture." }] } });
  expect(start).toHaveBeenCalledOnce();
  expect(start).toHaveBeenCalledWith(expect.objectContaining({
    title: "Datadog: Fixture alert", cwd: "/fixture/notes", activity: { source: "investigation", action: "datadog" },
    prompt: `${grant.prompt}\n\n## Caller context\n${JSON.stringify({ title: "Fixture alert", scope: "oncall", tags: ["service:fixture"] }, null, 2)}`,
    requestId: expect.any(String), canStart: expect.any(Function),
  }));
  expect(runtimeInventory(runtime).find(group => group.kind === "Agent runs")?.entries[0]).toContain(grant.prompt);
});

it("rejects undeclared, malformed, stale, failed and credential-bearing requests before dispatch", async () => {
  const { plugin, ctx, request, output, start } = fixture();
  const body = request.body as { jsonrpc: string; id: number; method: string; params: { name: string; arguments: Record<string, unknown> } };
  const invalidRequests: RuntimeRequest[] = [
    { ...request, path: "other" },
    { ...request, kind: "api" },
    { ...request, method: "GET" },
    { ...request, body: { ...body, method: "tools/list" } },
    { ...request, body: { ...body, params: { ...body.params, name: "other" } } },
    { ...request, body: { ...body, params: { ...body.params, arguments: { prompt: "worker supplied" } } } },
    { ...request, body: { ...body, params: { ...body.params, arguments: { title: "fixture-sensitive-value" } } } },
    { ...request, body: { ...body, params: { ...body.params, arguments: { tags: Array(101).fill("tag") } } } },
  ];
  for (const invalid of invalidRequests) await expect(applyRuntimeAgentRun(plugin, ctx, invalid, output, () => true, start)).rejects.toThrow();
  for (const invalid of [
    { ...output, id: 8 },
    { ...output, hostAgentRun: false },
    { ...output, result: { ...output.result, isError: true } },
    { ...output, result: { content: [{ type: "text", text: "No markers" }] } },
    { ...output, prompt: "worker supplied" },
    { ...output, hostSettings: { AWS_PROFILE: "dev" } },
    { ...output, result: { content: [{ type: "text", text: "fixture-sensitive-value __DEVHUB_AGENT_PROVIDER__ __DEVHUB_AGENT_RUN_ID__" }] } },
  ]) await expect(applyRuntimeAgentRun(plugin, ctx, request, invalid, () => true, start)).rejects.toThrow();
  await expect(applyRuntimeAgentRun(plugin, ctx, request, output, () => false, start)).rejects.toThrow();
  expect(start).not.toHaveBeenCalled();
  expect(await applyRuntimeAgentRun(plugin, ctx, request, { ok: true }, () => false, start)).toEqual({ ok: true });
});

it("reports an unknown outcome without replaying a failed dispatch", async () => {
  const { plugin, ctx, request, output } = fixture();
  const start = vi.fn(async (): Promise<never> => { throw new Error("fixture transport failed"); });
  const result = await applyRuntimeAgentRun(plugin, ctx, request, output, () => true, start, () => "/fixture/notes");
  expect(result).toMatchObject({ result: { isError: true, content: [{ text: expect.stringContaining("Check Agent Activity before retrying") }] } });
  expect(start).toHaveBeenCalledOnce();
});

it("starts a reviewed HTTP investigation and preserves its response contract", async () => {
  const { plugin, ctx, start, grant } = fixture();
  plugin.runtime.routes = [{ path: "/investigate", method: "POST" }];
  plugin.runtime.capabilities = { agentRuns: [{ path: "/investigate", method: "POST", label: grant.label, action: grant.action, prompt: grant.prompt, inputKeys: grant.inputKeys, titleKey: grant.titleKey }] };
  const request: RuntimeRequest = { kind: "api", path: "/investigate", method: "POST", body: { query: {}, body: { title: "Fixture alert", scope: "oncall" } } };
  const output = { status: 200, body: { ok: true }, hostAgentRun: true };
  expect(await applyRuntimeAgentRun(plugin, ctx, request, output, () => true, start, () => "/fixture/notes")).toEqual({ status: 200, body: { ok: true, providerLabel: "Fixture agent", runId: "run-fixture" } });
  await expect(applyRuntimeAgentRun(plugin, ctx, { ...request, path: "/other" }, output, () => true, start)).rejects.toThrow();
  await expect(applyRuntimeAgentRun(plugin, ctx, { ...request, body: { body: { title: "fixture-sensitive-value" } } }, output, () => true, start)).rejects.toThrow();
});

it("adds the host notes directory only to a reviewed HTTP preparation", async () => {
  const { plugin, ctx, start, grant } = fixture();
  plugin.runtime.routes = [{ path: "/investigate", method: "POST" }];
  plugin.runtime.capabilities = { agentRuns: [{ path: "/investigate", method: "POST", label: grant.label, action: grant.action, prompt: grant.prompt, inputKeys: [...grant.inputKeys, "prepare"], titleKey: grant.titleKey }] };
  const request: RuntimeRequest = { kind: "api", path: "/investigate", method: "POST", body: { body: { prepare: true, title: "Fixture" } } };
  const output = { status: 200, body: { ok: true, title: "Fixture", prompt: "Investigate fixture" }, hostAgentPrepare: true };
  expect(await applyRuntimeAgentRun(plugin, ctx, request, output, () => true, start, () => "/fixture/notes")).toEqual({ status: 200, body: { ...output.body, cwd: "/fixture/notes" } });
  await expect(applyRuntimeAgentRun(plugin, ctx, { ...request, body: { body: { title: "Fixture" } } }, output, () => true, start)).rejects.toThrow();
  expect(start).not.toHaveBeenCalled();
});

it("passes the current-review guard through asynchronous startup", async () => {
  const { plugin, ctx, request, output } = fixture();
  let current = true;
  const submitted = vi.fn();
  const start = vi.fn(async (input: BackgroundAgentOptions) => {
    await Promise.resolve();
    current = false;
    if (!input.canStart?.()) throw new Error("Review changed");
    submitted();
    return { channel: "run" as const, runId: "run-fixture", providerLabel: "Fixture agent" };
  });
  const result = await applyRuntimeAgentRun(plugin, ctx, request, output, () => current, start, () => "/fixture/notes");
  expect(result).toMatchObject({ result: { isError: true } });
  expect(submitted).not.toHaveBeenCalled();
});

it("requires distinct grants, a declared server, and reviewed caller fields", () => {
  const { grant, runtime } = fixture();
  for (const candidate of [
    { ...runtime, mcp: [] },
    { ...runtime, capabilities: { agentRuns: [grant, grant] } },
    { ...runtime, capabilities: { agentRuns: [{ ...grant, tool: "../bad" }] } },
    { ...runtime, capabilities: { agentRuns: [{ ...grant, cwd: "/tmp" }] } },
    { ...runtime, capabilities: { agentRuns: [{ ...grant, inputKeys: ["title", "title"] }] } },
    { ...runtime, capabilities: { agentRuns: [{ ...grant, inputKeys: ["scope"] }] } },
  ]) expect(runtimeSchema.safeParse(candidate).success).toBe(false);
});

it("dispatches only a reviewed, current sandboxed worker's tool call", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "runtime-agent-")));
  try {
    const source = path.join(root, "source");
    fs.cpSync(path.resolve("../../templates/runtime-plugin"), source, { recursive: true });
    const read = readManifest(source);
    if (!read.ok || !read.manifest.runtime) throw new Error("Invalid fixture");
    const runtime = read.manifest.runtime;
    runtime.mcp = [{ name: "datadog", description: "Fixture tools" }];
    runtime.capabilities = { agentRuns: [fixture().grant] };
    const worker = path.join(source, runtime.entry);
    fs.writeFileSync(worker, `import fs from "node:fs"; const input = JSON.parse(fs.readFileSync(0, "utf8")); process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: input.body.id, result: { content: [{ type: "text", text: "Started on __DEVHUB_AGENT_PROVIDER__ — agent run __DEVHUB_AGENT_RUN_ID__." }] }, hostAgentRun: true }));`);
    runtime.sha256 = hashFile(worker);
    fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(read.manifest));
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test", DEVHUB_CONFIG_DIR: path.join(root, "config"), DEVHUB_PLUGIN_HOME: path.join(root, "managed"), DEVHUB_PLUGIN_TARGET_HOME: path.join(root, "targets") };
    const ctx = pluginContext({ home: root, env, repoRoot: path.join(root, "core") });
    const review = await prepareLocal(ctx, source);
    if (!review.preview) throw new Error("Missing review");
    expect(review.preview.inventory.find(group => group.kind === "Agent runs")?.entries[0]).toContain("starts an agent");
    await confirmOperation(ctx, review.id, { accepted: true, revision: review.preview.revision, planDigest: review.preview.planDigest, selectedTargets: [] });
    vi.mocked(startBackgroundAgent).mockResolvedValue({ channel: "run", runId: "run-fixture", providerLabel: "Fixture agent" });
    const request = fixture().request;
    expect(await invokeRuntime(ctx, "sample-tools", request)).toEqual({ jsonrpc: "2.0", id: 7, result: { content: [{ type: "text", text: "Started on Fixture agent — agent run run-fixture." }] } });
    expect(startBackgroundAgent).toHaveBeenCalledOnce();
    const aborted = new AbortController();
    aborted.abort();
    await expect(invokeRuntime(ctx, "sample-tools", request, aborted.signal)).rejects.toThrow();
    const disable = await startLifecycle(ctx, "sample-tools", "disable");
    if (!disable.preview) throw new Error("Missing disable review");
    await confirmOperation(ctx, disable.id, { accepted: true, revision: disable.preview.revision, planDigest: disable.preview.planDigest, selectedTargets: [] });
    await expect(invokeRuntime(ctx, "sample-tools", request)).rejects.toThrow();
    expect(startBackgroundAgent).toHaveBeenCalledOnce();
  } finally {
    vi.clearAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
