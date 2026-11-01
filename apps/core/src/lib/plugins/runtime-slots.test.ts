import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTask, writeItem } from "../../domains/tasks/store";
import { pluginContext } from "./context";
import { confirmOperation, prepareLocal, startLifecycle } from "./operations";
import { hashFile } from "./inspect";
import { readManifest } from "./manifest";
import { invokeRuntime, loadRuntime } from "./runtime-host";
import { runtimeSchema } from "../../../../../packages/shared/ui-lib/plugins/runtime-contract";
import { invokeRuntimeSlot, resolveSlotContext, runtimeSlots } from "./runtime-slots";

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
async function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "runtime-slots-")));
  roots.push(root);
  const source = path.join(root, "source"), tasks = path.join(root, "tasks");
  fs.cpSync(path.resolve("../../templates/runtime-plugin"), source, { recursive: true });
  for (const [key, value] of Object.entries({ TASKS_DIR: tasks, NOTES_DIR: path.join(root, "notes"), DEVHUB_CONFIG_DIR: path.join(root, "config"), DEVHUB_REPOS_DIR: path.join(root, "repos"), DEVHUB_PROFILE: "work" })) vi.stubEnv(key, value);
  fs.mkdirSync(path.join(tasks, "work"), { recursive: true });
  fs.mkdirSync(path.join(root, "repos", "example", ".git"), { recursive: true });
  const task = createTask(path.join(tasks, "work"), { text: "Real fixture task" });
  const ctx = pluginContext({ home: root, repoRoot: root, env: { NODE_ENV: "test", DEVHUB_CONFIG_DIR: path.join(root, "config"), DEVHUB_PLUGIN_HOME: path.join(root, "managed"), DEVHUB_PLUGIN_TARGET_HOME: path.join(root, "targets"), FIXTURE_SECRET: "fixture-private-value" } });
  const parsed = readManifest(source);
  if (!parsed.ok || !parsed.manifest.runtime) throw new Error("Invalid fixture");
  const manifest = parsed.manifest;
  const runtime = parsed.manifest.runtime;
  runtime.capabilities = { slots: ["repo", "setup", "task"].map((location) => ({ id: location, location: location as "repo" | "setup" | "task", label: `${location} fixture`, routes: [{ path: "/read", method: "GET" }, { path: "/write", method: "POST", confirmation: "Write fixture data?" }, { path: "/slow", method: "GET" }] })) };
  runtime.permissions.env = ["FIXTURE_SECRET"];
  fs.writeFileSync(path.join(source, runtime.entry), `import fs from 'node:fs';let text='';for await(const c of process.stdin)text+=c;const r=JSON.parse(text);if(r.body.action?.path==='/slow')await new Promise(resolve=>setTimeout(resolve,10000));if(r.body.action?.path==='/write')fs.appendFileSync('writes.log','once\\n');process.stdout.write(JSON.stringify(r.method==='GET'?'<h1>'+r.body.context.location+'</h1>':{context:r.body.context,secret:process.env.FIXTURE_SECRET}));`);
  runtime.sha256 = hashFile(path.join(source, runtime.entry));
  fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(manifest));
  const review = await prepareLocal(ctx, source);
  if (!review.preview) throw new Error("Missing preview");
  expect(review.preview.canApply).toBe(true);
  expect(review.preview.inventory.find((group) => group.kind === "Host slots")?.entries).toHaveLength(3);
  await confirmOperation(ctx, review.id, { accepted: true, revision: review.preview.revision, planDigest: review.preview.planDigest, selectedTargets: [] });
  const request = (location: "repo" | "setup" | "task") => ({ plugin: "sample-tools", slot: location, revision: runtimeSlots(ctx, location)[0].revision, context: location === "repo" ? { location, repoName: "example" } : location === "task" ? { location, taskId: task.id, createdAt: task.createdAt, profile: "work" } : { location } });
  return { root, ctx, task, tasks, runtime, request };
}

describe("reviewed host slots", () => {
  it("serves all three slots and only passes resolved host context to the real worker", async () => {
    const { ctx, request, root, task } = await fixture();
    for (const location of ["repo", "setup", "task"] as const) expect(await invokeRuntimeSlot(ctx, request(location))).toBe(`<h1>${location}</h1>`);
    expect(await invokeRuntimeSlot(ctx, { ...request("repo"), action: { path: "/read", method: "GET" } })).toMatchObject({ context: { repoPath: path.join(root, "repos/example") }, secret: "[redacted]" });
    expect(await invokeRuntimeSlot(ctx, { ...request("task"), action: { path: "/read", method: "GET" } })).toMatchObject({ context: { taskId: task.id, title: "Real fixture task", profile: "work", readOnly: false } });
  });
  it("refuses unknown capabilities, duplicated slot ids, unconfirmed writes and unknown actions", async () => {
    const { ctx, runtime, request } = await fixture();
    expect(runtimeSchema.safeParse({ ...runtime, capabilities: { unknown: {} } }).success).toBe(false);
    expect(runtimeSchema.safeParse({ ...runtime, capabilities: { slots: [runtime.capabilities!.slots![0], runtime.capabilities!.slots![0]] } }).success).toBe(false);
    expect(runtimeSchema.safeParse({ ...runtime, capabilities: { slots: [{ id: "x", location: "task", label: "X", routes: [{ path: "/write", method: "POST" }] }] } }).success).toBe(false);
    await expect(invokeRuntimeSlot(ctx, { ...request("setup"), action: { path: "/write", method: "POST" } })).rejects.toMatchObject({ code: "SLOT_CONFIRM" });
    await expect(invokeRuntimeSlot(ctx, { ...request("setup"), action: { path: "/foreign", method: "GET" } })).rejects.toMatchObject({ code: "SLOT_ACTION" });
    await expect(invokeRuntime(ctx, "sample-tools", { kind: "api", path: "/write", method: "POST" })).rejects.toMatchObject({ code: "RUNTIME_ROUTE" });
  });
  it("rejects forged context, wrong slot locations and stale reviewed revisions before running", async () => {
    const { ctx, request } = await fixture();
    await expect(invokeRuntimeSlot(ctx, { ...request("repo"), context: { location: "repo", repoName: "../example" } })).rejects.toMatchObject({ code: "SLOT_REQUEST" });
    await expect(invokeRuntimeSlot(ctx, { ...request("repo"), context: { location: "repo", repoName: "example", repoPath: "/forged" } })).rejects.toMatchObject({ code: "SLOT_REQUEST" });
    await expect(invokeRuntimeSlot(ctx, { ...request("repo"), context: { location: "setup" } })).rejects.toMatchObject({ code: "SLOT_MISSING" });
    await expect(invokeRuntimeSlot(ctx, { ...request("setup"), revision: "0".repeat(64) })).rejects.toMatchObject({ code: "SLOT_CHANGED" });
  });
  it("checks the live task identity, profile and ownership on each write", async () => {
    const { ctx, request, task, tasks } = await fixture();
    const input = { ...request("task"), confirmed: true, action: { path: "/write", method: "POST" } };
    await invokeRuntimeSlot(ctx, input);
    expect(fs.readFileSync(path.join(ctx.paths.pluginHome, "runtime-data", loadRuntime(ctx, "sample-tools").id, "writes.log"), "utf8")).toBe("once\n");
    for (const patch of [{ done: true }, { endDate: "2026-10-28", endReason: "legacy-moved" as const }, { abandonedAt: "2026-10-28T00:00:00Z" }, { handoff: { handoffId: "h1", toUserId: "U1", toName: "Fixture", status: "pending" as const, expiresAt: Date.now() + 10000 } }, { teamPickup: { handoffId: "h1", cwd: "/fixture", branch: "main", status: "pending" as const } }]) {
      writeItem(path.join(tasks, "work"), { ...task, ...patch });
      await expect(invokeRuntimeSlot(ctx, input)).rejects.toMatchObject({ code: "SLOT_READ_ONLY" });
    }
    writeItem(path.join(tasks, "work"), task);
    await expect(invokeRuntimeSlot(ctx, { ...input, context: { ...input.context, createdAt: "wrong" } })).rejects.toMatchObject({ code: "SLOT_TASK" });
    vi.stubEnv("DEVHUB_PROFILE", "home");
    await expect(invokeRuntimeSlot(ctx, input)).rejects.toMatchObject({ code: "SLOT_PROFILE" });
  });
  it("removes disabled slots and cancels active work without replay", async () => {
    const { ctx, request } = await fixture();
    const input = request("setup");
    const controller = new AbortController();
    const pending = invokeRuntimeSlot(ctx, { ...request("setup"), action: { path: "/slow", method: "GET" } }, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: "RUNTIME_FAILED" });
    controller.abort();
    await rejected;
    const disable = await startLifecycle(ctx, "sample-tools", "disable");
    if (!disable.preview) throw new Error("Missing preview");
    await confirmOperation(ctx, disable.id, { accepted: true, revision: disable.preview.revision, planDigest: disable.preview.planDigest, selectedTargets: [] });
    expect(runtimeSlots(ctx, "setup")).toEqual([]);
    await expect(invokeRuntimeSlot(ctx, input)).rejects.toMatchObject({ code: "RUNTIME_DISABLED" });
  });
  it("refuses invalid or missing contexts without touching the worker", () => {
    expect(() => resolveSlotContext({ location: "task", taskId: "x", createdAt: "x", profile: "../work" })).toThrow();
    expect(() => resolveSlotContext({ location: "repo", repoName: "missing" })).toThrow();
  });
});
