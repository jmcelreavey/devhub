import { fileURLToPath } from "node:url";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { execExternal } from "../exec-external";
import { pluginContext } from "./context";
import { hashFile } from "./inspect";
import { readManifest } from "./manifest";
import { confirmOperation, prepareLocal, startLifecycle } from "./operations";
import { loadRuntime, invokeRuntime } from "./runtime-host";
import { runtimeSchema } from "../../../../../packages/shared/ui-lib/plugins/runtime-contract";
import { approveRuntimeService, reviewRuntimeService, revokeRuntimeService, RuntimeServiceSupervisor } from "./runtime-supervisor";
import type { PluginOperationView } from "../../../../../packages/shared/ui-lib/plugins/model";

const roots: string[] = [];
const owners: RuntimeServiceSupervisor[] = [];
const serviceWorker = `import fs from 'node:fs';
let text=''; for await(const chunk of process.stdin)text+=chunk;
const request=JSON.parse(text);
if(request.kind!=='service')throw new Error('Wrong kind');
fs.appendFileSync('starts.log', process.pid+'\\n');
fs.writeFileSync('env.json', JSON.stringify({secret:process.env.SERVICE_TOKEN,other:process.env.OTHER_TOKEN,kind:request.kind}));
setInterval(()=>fs.appendFileSync('ticks.log',process.pid+'\\n'),20);`;

function consent(view: PluginOperationView) {
  if (!view.preview) throw new Error("Missing preview");
  return { accepted: true, revision: view.preview.revision, planDigest: view.preview.planDigest, selectedTargets: [] };
}
async function fixture(worker = serviceWorker, exec = false, tasks?: Array<"profile" | "read" | "handoff">) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "runtime-service-")));
  roots.push(root);
  const source = path.join(root, "source");
  fs.cpSync(path.resolve("../../templates/runtime-plugin"), source, { recursive: true });
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", SERVICE_TOKEN: "declared-fixture-value", OTHER_TOKEN: "not-shared", DEVHUB_CONFIG_DIR: path.join(root, "config"), DEVHUB_PLUGIN_HOME: path.join(root, "managed"), DEVHUB_PLUGIN_TARGET_HOME: path.join(root, "targets") };
  const ctx = pluginContext({ home: root, env, repoRoot: path.join(root, "core") });
  const read = readManifest(source);
  if (!read.ok || !read.manifest.runtime) throw new Error("Invalid fixture");
  const manifest = read.manifest, runtime = read.manifest.runtime;
  runtime.capabilities = { service: { id: "socket", label: "Fixture connection", maxRunSeconds: 30, ...(tasks ? { tasks } : {}) } };
  if (tasks?.length) runtime.permissions.network = ["127.0.0.1"];
  runtime.permissions.env = ["SERVICE_TOKEN"];
  runtime.permissions.exec = exec;
  fs.writeFileSync(path.join(source, runtime.entry), worker);
  runtime.sha256 = hashFile(path.join(source, runtime.entry));
  fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(manifest));
  const review = await prepareLocal(ctx, source);
  expect(review.preview?.canApply).toBe(true);
  expect(review.preview?.inventory.find((group) => group.kind === "Background service")?.entries[0]).toContain("off until separately approved");
  expect((await confirmOperation(ctx, review.id, consent(review))).state).toBe("succeeded");
  const plugin = loadRuntime(ctx, "sample-tools");
  const data = path.join(ctx.paths.pluginHome, "runtime-data", plugin.id);
  const supervisor = () => {
    const value = new RuntimeServiceSupervisor(ctx, { pollMs: 25, retryMs: 10 });
    owners.push(value);
    return value;
  };
  const approve = () => approveRuntimeService(ctx, "sample-tools", reviewRuntimeService(ctx, "sample-tools").digest);
  const starts = () => fs.existsSync(path.join(data, "starts.log")) ? fs.readFileSync(path.join(data, "starts.log"), "utf8").trim().split("\n").map(Number) : [];
  return { ctx, source, root, manifest, runtime, plugin, data, supervisor, approve, starts };
}
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function serviceTaskRequest(endpoint: { port: number; token: string }): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(endpoint.port, "127.0.0.1");
    let text = "";
    socket.once("connect", () => socket.write(JSON.stringify({ token: endpoint.token, request: { operation: "profile" } }) + "\n"));
    socket.on("data", (chunk: Buffer) => { text += chunk.toString("utf8"); });
    socket.once("end", () => { try { resolve(JSON.parse(text)); } catch (error) { reject(error); } });
    socket.once("error", reject);
    socket.setTimeout(5000, () => { socket.destroy(); reject(new Error("Fixture request timed out")); });
  });
}
afterEach(async () => {
  await Promise.all(owners.splice(0).map((owner) => owner.stop()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("reviewed primary-only runtime services", () => {
  it("restarts only when reviewed environment changes, without overlapping owners", async () => {
    const f = await fixture();
    await f.approve();
    const owner = f.supervisor();
    owner.start();
    await vi.waitFor(() => expect(f.starts()).toHaveLength(1));
    const first = f.starts()[0];
    f.ctx.env.OTHER_TOKEN = "fixture-unreviewed-change";
    await owner.reconcile();
    expect(f.starts()).toHaveLength(1);
    f.ctx.env.SERVICE_TOKEN = "fixture-reviewed-change";
    await vi.waitFor(() => expect(f.starts()).toHaveLength(2));
    expect(alive(first)).toBe(false);
    expect(alive(f.starts()[1])).toBe(true);
    expect(JSON.stringify(owner.status())).not.toContain("fixture-reviewed-change");
    await owner.stop();
    expect(f.starts().some(alive)).toBe(false);
  });
  it("stays off after install/review, requires current consent and denies secondary instances", async () => {
    const f = await fixture();
    const owner = f.supervisor();
    await owner.reconcile();
    expect(owner.status()).toEqual({});
    expect(f.starts()).toEqual([]);
    const secondary = new RuntimeServiceSupervisor({ ...f.ctx, env: { ...f.ctx.env, DEVHUB_SCHEDULER: "0" } });
    expect(() => secondary.start()).toThrow(/primary/);
    await expect(secondary.reconcile()).rejects.toMatchObject({ code: "SERVICE_SECONDARY" });
    await expect(approveRuntimeService(f.ctx, "sample-tools", "0".repeat(64))).rejects.toMatchObject({ code: "SERVICE_CHANGED" });
    await f.approve();
    expect(f.starts()).toEqual([]);
    owner.start();
    await vi.waitFor(() => expect(f.starts()).toHaveLength(1));
    expect(JSON.parse(fs.readFileSync(path.join(f.data, "env.json"), "utf8"))).toEqual({ secret: "declared-fixture-value", kind: "service" });
    await revokeRuntimeService(f.ctx, "sample-tools");
    await vi.waitFor(() => expect(alive(f.starts()[0])).toBe(false));
  });

  it("allows only one owner, stops on disable/revocation and releases ownership after shutdown", async () => {
    const f = await fixture();
    await f.approve();
    const first = f.supervisor(), second = f.supervisor();
    first.start(); second.start();
    await vi.waitFor(() => expect(f.starts()).toHaveLength(1));
    expect([first.status()["sample-tools"].state, second.status()["sample-tools"].state].sort()).toEqual(["running", "waiting"]);
    await first.stop();
    await vi.waitFor(() => expect(f.starts()).toHaveLength(2));
    expect(alive(f.starts()[0])).toBe(false);
    const disable = await startLifecycle(f.ctx, "sample-tools", "disable");
    await confirmOperation(f.ctx, disable.id, consent(disable));
    await vi.waitFor(() => expect(alive(f.starts()[1])).toBe(false));
    const enable = await startLifecycle(f.ctx, "sample-tools", "enable");
    await confirmOperation(f.ctx, enable.id, consent(enable));
    await vi.waitFor(() => expect(f.starts()).toHaveLength(3));
    await revokeRuntimeService(f.ctx, "sample-tools");
    await vi.waitFor(() => expect(alive(f.starts()[2])).toBe(false));
    expect(second.status()).toEqual({});
  });

  it("reconnects after a crash with bounded retries, keeps data and replays no request", async () => {
    const f = await fixture(`import fs from 'node:fs'; let text='';for await(const chunk of process.stdin)text+=chunk;const r=JSON.parse(text);fs.appendFileSync('starts.log',process.pid+'\\n');fs.appendFileSync('requests.log',r.kind+' '+r.method+'\\n');if(!fs.existsSync('crashed')){fs.writeFileSync('crashed','once');process.exit(1);}setInterval(()=>{},100);`);
    await f.approve();
    const owner = f.supervisor(); owner.start();
    await vi.waitFor(() => expect(f.starts()).toHaveLength(2));
    expect(alive(f.starts()[0])).toBe(false);
    expect(fs.readFileSync(path.join(f.data, "crashed"), "utf8")).toBe("once");
    expect(fs.readFileSync(path.join(f.data, "requests.log"), "utf8")).toBe("service START\nservice START\n");
    await owner.stop();
    expect(f.starts().some(alive)).toBe(false);
  });

  it.each(["stdout", "stderr"])("kills excessive %s, caps retries and never exposes child output", async (stream) => {
    const f = await fixture(`import fs from 'node:fs';fs.appendFileSync('starts.log',process.pid+'\\n');process.${stream}.write('declared-fixture-value'.repeat(20000));setInterval(()=>{},100);`);
    await f.approve();
    const owner = f.supervisor(); owner.start();
    await vi.waitFor(() => expect(owner.status()["sample-tools"]?.state).toBe("failed"), { timeout: 8000 });
    expect(f.starts()).toHaveLength(5);
    expect(f.starts().some(alive)).toBe(false);
    expect(JSON.stringify(owner.status())).not.toContain("declared-fixture-value");
    // Explicit re-approval is the only way out of a repeated failure.
    await f.approve();
    await vi.waitFor(() => expect(f.starts().length).toBeGreaterThan(5));
  });

  it("stops a changed or replaced snapshot and requires fresh service consent", async () => {
    const f = await fixture();
    await f.approve();
    const owner = f.supervisor(); owner.start();
    await vi.waitFor(() => expect(f.starts()).toHaveLength(1));
    fs.appendFileSync(path.join(f.source, f.runtime.entry), "\n// next snapshot");
    f.runtime.sha256 = hashFile(path.join(f.source, f.runtime.entry));
    fs.writeFileSync(path.join(f.source, "devhub-plugin.json"), JSON.stringify(f.manifest));
    const replacement = await prepareLocal(f.ctx, f.source, { reviewRuntimeReplacement: true });
    expect((await confirmOperation(f.ctx, replacement.id, consent(replacement))).state).toBe("succeeded");
    await vi.waitFor(() => expect(alive(f.starts()[0])).toBe(false));
    await owner.reconcile();
    expect(owner.status()).toEqual({});
    expect(reviewRuntimeService(f.ctx, "sample-tools").enabled).toBe(false);
    await f.approve();
    await vi.waitFor(() => expect(f.starts()).toHaveLength(2));
    const plugin = loadRuntime(f.ctx, "sample-tools");
    fs.appendFileSync(path.join(plugin.root, f.runtime.entry), "\n// unreviewed");
    await vi.waitFor(() => expect(alive(f.starts()[1])).toBe(false));
  });

  it.skipIf(process.platform === "win32")("stops subprocess helpers with their service", async () => {
    const f = await fixture(`import fs from 'node:fs';import {spawn} from 'node:child_process';const helper=spawn(process.execPath,['-e','setInterval(()=>{},100)'],{stdio:'ignore'});fs.appendFileSync('starts.log',process.pid+'\\n');fs.writeFileSync('helper.pid',String(helper.pid));setInterval(()=>{},100);`, true);
    await f.approve();
    const owner = f.supervisor(); owner.start();
    await vi.waitFor(() => expect(f.starts()).toHaveLength(1));
    const helper = Number(fs.readFileSync(path.join(f.data, "helper.pid"), "utf8"));
    expect(alive(helper)).toBe(true);
    await owner.stop();
    await vi.waitFor(() => expect(alive(helper)).toBe(false));
    expect(f.starts().some(alive)).toBe(false);
  });

  it("starts a reviewed task bridge only with a current service approval", async () => {
    const worker = `import fs from 'node:fs';let text='';for await(const chunk of process.stdin)text+=chunk;fs.writeFileSync('host.json',process.env.DEVHUB_RUNTIME_SERVICE_TASKS);setInterval(()=>{},1000);`;
    const f = await fixture(worker, false, ["profile"]);
    vi.stubEnv("TASKS_DIR", path.join(f.root, "tasks"));
    vi.stubEnv("DEVHUB_CONFIG_DIR", path.join(f.root, "profile-config"));
    vi.stubEnv("DEVHUB_PROFILE", "");
    await f.approve();
    const owner = new RuntimeServiceSupervisor(f.ctx, { pollMs: 60_000 });
    owners.push(owner);
    owner.start();
    const endpointFile = path.join(f.data, "host.json");
    await vi.waitFor(() => expect(fs.existsSync(endpointFile)).toBe(true));
    const endpoint = JSON.parse(fs.readFileSync(endpointFile, "utf8")) as { port: number; token: string };
    expect(await serviceTaskRequest(endpoint)).toEqual({ ok: true, result: { activeProfile: "legacy", profiles: [] } });
    await revokeRuntimeService(f.ctx, "sample-tools");
    expect(await serviceTaskRequest(endpoint)).toEqual({ ok: false });
    await owner.stop();
    await expect(serviceTaskRequest(endpoint)).rejects.toThrow();
  });

  it("enforces the reviewed connection deadline", async () => {
    const f = await fixture();
    await f.approve();
    const owner = f.supervisor();
    await owner.reconcile();
    await vi.waitFor(() => expect(f.starts()).toHaveLength(1));
    const pid = f.starts()[0];
    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 32000, interval: 100 });
    expect(owner.status()["sample-tools"]).toEqual({ state: "retrying", attempts: 1 });
  }, 35000);

  it("rejects undeclared services, unsafe contracts and direct request invocation", async () => {
    const f = await fixture();
    expect(runtimeSchema.safeParse({ ...f.runtime, capabilities: { service: { ...f.runtime.capabilities!.service!, autoStart: true } } }).success).toBe(false);
    expect(runtimeSchema.safeParse({ ...f.runtime, capabilities: { service: { ...f.runtime.capabilities!.service!, maxRunSeconds: 0 } } }).success).toBe(false);
    await expect(invokeRuntime(f.ctx, "sample-tools", { kind: "api", path: "/socket", method: "POST" })).rejects.toMatchObject({ code: "RUNTIME_ROUTE" });
    fs.symlinkSync(f.root, path.join(f.ctx.paths.configDir, "runtime-services"));
    await expect(f.approve()).rejects.toThrow(/safe regular path/);
  });

  it("retires an orphan before a second process can own the connection", async () => {
    const f = await fixture();
    await f.approve();
    const script = path.join(f.root, "owner.mts");
    fs.writeFileSync(script, `import {pluginContext} from ${JSON.stringify(fileURLToPath(new URL("./context.ts", import.meta.url)))};import {RuntimeServiceSupervisor} from ${JSON.stringify(fileURLToPath(new URL("./runtime-supervisor.ts", import.meta.url)))};const s=new RuntimeServiceSupervisor(pluginContext({home:${JSON.stringify(f.root)},env:process.env}),{pollMs:25});import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(path.join(f.root, "owner.pid"))},String(process.pid));s.start();setInterval(()=>{},1000);`);
    const pidFile = path.join(f.root, "owner.pid");
    let parent = 0;
    const pending = execExternal(process.execPath, ["--import", "tsx", script], {
      cwd: process.cwd(), env: { ...process.env, ...f.ctx.env, DEVHUB_SCHEDULER: "1" }, timeoutMs: 40000,
    });
    const terminated = expect(pending).rejects.toBeTruthy();
    try {
      await vi.waitFor(() => expect(f.starts()).toHaveLength(1), { timeout: 30000, interval: 100 });
      parent = Number(fs.readFileSync(pidFile, "utf8"));
      expect(parent).toBeGreaterThan(0);
      const child = f.starts()[0];
      process.kill(parent, "SIGKILL");
      const next = f.supervisor(); next.start();
      await vi.waitFor(() => expect(f.starts()).toHaveLength(2));
      expect(alive(child)).toBe(false);
      await next.stop();
      expect(f.starts().some(alive)).toBe(false);
    } finally {
      if (parent && alive(parent)) process.kill(parent, "SIGKILL");
      await terminated;
    }
  }, 60000);
});
