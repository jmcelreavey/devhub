import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as external from "../exec-external";
import * as dashboardEnv from "../dashboard-env-local";
import { pluginContext } from "./context";
import { confirmOperation, prepareLocal, startLifecycle } from "./operations";
import { runtimeSchema, permissionChanges } from "../../../../../packages/shared/ui-lib/plugins/runtime-contract";
import { runtimeFile, verifyRuntimeFiles } from "./runtime-files";
import { invokeRuntime, loadRuntime, runtimeCatalog, runtimeEnvironment, runtimeWorkerOptions } from "./runtime-host";
import { resolveRuntimeAlias } from "./runtime-aliases";
import { handleRuntimeAlias } from "./runtime-aliases";
import { resolveTerminalProposal } from "../terminal/proposals";
import { runtimeSlots } from "./runtime-slots";
import { runtimeThemeCatalog } from "./runtime-themes";
import { approveRuntimeService, reviewRuntimeService } from "./runtime-supervisor";
import { reviewedFixtures, writeReviewedFixture } from "./__fixtures__/same-build";
import { whichOnPath } from "./runtime";
import { readManifest } from "./manifest";
import { hashFile } from "./inspect";
import type { PluginOperationView } from "../../../../../packages/shared/ui-lib/plugins/model";

const roots: string[] = [];
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "runtime-plugin-")));
  roots.push(root);
  const source = path.join(root, "source");
  fs.cpSync(path.resolve("../../templates/runtime-plugin"), source, { recursive: true });
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", DEVHUB_CONFIG_DIR: path.join(root, "config"), DEVHUB_PLUGIN_HOME: path.join(root, "managed"), DEVHUB_PLUGIN_TARGET_HOME: path.join(root, "targets") };
  const ctx = pluginContext({ home: root, env, repoRoot: path.join(root, "core") });
  const manifest = readManifest(source);
  if (!manifest.ok || !manifest.manifest.runtime) throw new Error("Invalid fixture");
  return { root, source, ctx, manifest: manifest.manifest, runtime: manifest.manifest.runtime };
}
function consent(view: PluginOperationView) {
  if (!view.preview) throw new Error("Missing preview");
  return { accepted: true, revision: view.preview.revision, planDigest: view.preview.planDigest, selectedTargets: [] };
}
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("portable runtime plugins", () => {
  it("replaces and removes every reviewed fixture through one host", async () => {
    const { root, ctx } = fixture();
    for (const kind of reviewedFixtures) {
      const name = `fixture-${kind}`;
      const source = path.join(root, `source-${kind}`);
      const candidate = writeReviewedFixture(source, kind);
      const install = await prepareLocal(ctx, source);
      expect((await confirmOperation(ctx, install.id, consent(install))).state).toBe("succeeded");
      const first = loadRuntime(ctx, name);
      const data = path.join(ctx.paths.pluginHome, "runtime-data", first.id, "state.json");
      fs.mkdirSync(path.dirname(data), { recursive: true });
      fs.writeFileSync(data, "retained fixture data");
      expect(await invokeRuntime(ctx, name, { kind: "page", path: "/", method: "GET" })).toContain("Sample tools");
      expect(await invokeRuntime(ctx, name, { kind: "api", path: "/status", method: "GET" })).toEqual({ message: "The plugin API is working." });
      expect(await invokeRuntime(ctx, name, { kind: "mcp", path: "sample", method: "POST", body: { jsonrpc: "2.0", id: 1, method: "tools/list" } })).toMatchObject({ result: { tools: [{ name: "status" }] } });
      expect(resolveRuntimeAlias(ctx, `/api/${name}/status`, "GET", [])?.plugin.id).toBe(first.id);
      if (kind === "slots") expect(runtimeSlots(ctx, "setup")).toMatchObject([{ plugin: name, id: "setup" }]);
      if (kind === "theme") expect(runtimeThemeCatalog(ctx)).toMatchObject([{ plugin: name, id: "fixture-theme" }]);
      if (kind === "service") {
        const service = reviewRuntimeService(ctx, name);
        expect(service.enabled).toBe(false);
        await approveRuntimeService(ctx, name, service.digest);
        expect(reviewRuntimeService(ctx, name).enabled).toBe(true);
      }

      candidate.update();
      const update = await prepareLocal(ctx, source, { reviewRuntimeReplacement: true });
      expect((await confirmOperation(ctx, update.id, consent(update))).state).toBe("succeeded");
      const replaced = loadRuntime(ctx, name);
      expect(replaced.id).toBe(first.id);
      expect(replaced.revision).not.toBe(first.revision);
      if (kind === "service") expect(reviewRuntimeService(ctx, name).enabled).toBe(false);
      if (kind === "theme") expect(runtimeThemeCatalog(ctx)[0].revision).toBe(replaced.revision);
      fs.rmSync(source, { recursive: true });
      expect(await invokeRuntime(ctx, name, { kind: "api", path: "/status", method: "GET" })).toEqual({ message: "The plugin API is working." });
      const disable = await startLifecycle(ctx, name, "disable");
      expect((await confirmOperation(ctx, disable.id, consent(disable))).state).toBe("succeeded");
      expect(runtimeCatalog(ctx).some(plugin => plugin.name === name)).toBe(false);
      expect(() => loadRuntime(ctx, name)).toThrow(/not enabled/);
      if (kind === "slots") expect(runtimeSlots(ctx, "setup")).toEqual([]);
      if (kind === "theme") expect(runtimeThemeCatalog(ctx)).toEqual([]);
      const remove = await startLifecycle(ctx, name, "remove");
      expect((await confirmOperation(ctx, remove.id, consent(remove))).state).toBe("succeeded");
      expect(runtimeCatalog(ctx).some(plugin => plugin.name === name)).toBe(false);
      expect(resolveRuntimeAlias(ctx, `/api/${name}/status`, "GET", [])).toBeNull();
      expect(fs.readFileSync(data, "utf8")).toBe("retained fixture data");
    }
  }, 120000);

  it("reviews without execution, then serves a real page, API and MCP request from the installed copy", async () => {
    const { ctx, source } = fixture();
    const run = vi.spyOn(external, "execExternal");
    const review = await prepareLocal(ctx, source);
    expect(review.preview?.canApply).toBe(true);
    expect(review.preview?.inventory.some((group) => group.kind === "Environment and secrets")).toBe(true);
    // Review may list the plugin's Git-visible files, but runs nothing else.
    expect(run.mock.calls.filter(([file]) => file !== "git")).toEqual([]);
    expect(() => loadRuntime(ctx, "sample-tools")).toThrow(/not enabled/);
    expect((await confirmOperation(ctx, review.id, consent(review))).state).toBe("succeeded");
    const page = await invokeRuntime(ctx, "sample-tools", { kind: "page", path: "/", method: "GET" });
    expect(page).toContain("Sample tools");
    await expect(invokeRuntime(ctx, "sample-tools", { kind: "database", path: "resolve", method: "POST" })).rejects.toThrow(/did not declare/);
    expect(await invokeRuntime(ctx, "sample-tools", { kind: "api", path: "/status", method: "GET" })).toEqual({ message: "The plugin API is working." });
    const mcp = await invokeRuntime(ctx, "sample-tools", { kind: "mcp", path: "sample", method: "POST", body: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(mcp).toMatchObject({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "status" }] } });
    expect(run.mock.calls.at(-1)?.[2]?.timeoutMs).toBe(30000);
    await expect(invokeRuntime(ctx, "sample-tools", { kind: "api", path: "/undeclared", method: "POST" })).rejects.toThrow(/did not declare/);
    const disable = await startLifecycle(ctx, "sample-tools", "disable");
    await confirmOperation(ctx, disable.id, consent(disable));
    expect(() => loadRuntime(ctx, "sample-tools")).toThrow(/not enabled/);
  });

  it("streams real worker progress before completion and uses the reviewed deadline", async () => {
    const { ctx, source, manifest, runtime } = fixture();
    runtime.routes = [{ path: "/run", method: "POST", stream: true, timeoutSeconds: 45 }];
    fs.writeFileSync(path.join(source, runtime.entry), 'process.stdout.write(JSON.stringify({type:"output",text:"running"})+"\\n"); setTimeout(()=>process.stdout.write(JSON.stringify({type:"result",result:{ok:true}})+"\\n"), 50);');
    runtime.sha256 = hashFile(path.join(source, runtime.entry));
    fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(manifest));
    const review = await prepareLocal(ctx, source);
    await confirmOperation(ctx, review.id, consent(review));
    const externalCall = vi.spyOn(external, "execExternal");
    const events: unknown[] = [];
    expect(await invokeRuntime(ctx, "sample-tools", { kind: "api", path: "/run", method: "POST" }, undefined, event => events.push(event))).toEqual({ ok: true });
    expect(events).toEqual([{ type: "output", text: "running" }]);
    expect(externalCall.mock.calls.at(-1)?.[2]?.timeoutMs).toBe(45000);
  });

  it("delivers a reviewed alias approval once to the installed worker", async () => {
    const { ctx, source, manifest, runtime } = fixture();
    vi.stubEnv("DEVHUB_CORE_ROUTE_NAMESPACES", JSON.stringify(["/api/tasks"]));
    vi.stubEnv("DEVHUB_BIND_HOST", "127.0.0.1");
    try {
      runtime.routes = [{ path: "/write", method: "POST" }];
      runtime.aliases = [{ kind: "api", path: "/api/fixture-write", target: "/write", method: "POST" }];
      runtime.capabilities = { approvals: [{ path: "/write", method: "POST" }] };
      fs.writeFileSync(path.join(source, runtime.entry), `let data="";for await(const chunk of process.stdin)data+=chunk;const req=JSON.parse(data);const decision=req.hostApproval;console.log(JSON.stringify(!decision?{status:202,body:{ok:true},hostApproval:{id:"fixture",summary:"Review fixture write",payload:{value:req.body.body.value}}}:decision.status==="pending"?{status:202,body:{pending:true}}:{status:200,body:{status:decision.status,value:decision.payload.value}}));`);
      runtime.sha256 = hashFile(path.join(source, runtime.entry));
      fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(manifest));
      const review = await prepareLocal(ctx, source);
      await confirmOperation(ctx, review.id, consent(review));
      const call = (body: unknown) => handleRuntimeAlias(new Request("http://localhost:1437/api/fixture-write", { method: "POST", headers: { host: "localhost:1437", origin: "http://localhost:1437", "content-type": "application/json" }, body: JSON.stringify(body) }), ctx);
      const first = await call({ value: "reviewed" });
      expect(first.status).toBe(202);
      const pending = await first.json();
      expect(pending.hostApproval).toEqual({ proposalId: expect.any(String), status: "pending" });
      const id = pending.hostApproval.proposalId as string;
      expect(await (await call({ value: "changed", hostApprovalId: id })).json()).toEqual({ pending: true });
      resolveTerminalProposal(id, "approve");
      expect(await (await call({ value: "changed", hostApprovalId: id })).json()).toEqual({ status: "approved", value: "reviewed" });
      expect((await call({ value: "changed", hostApprovalId: id })).status).toBe(502);
    } finally { vi.unstubAllEnvs(); }
  });

  it("starts a background worker only after alias approval and streams its output", async () => {
    const { ctx, source, manifest, runtime } = fixture();
    vi.stubEnv("DEVHUB_CORE_ROUTE_NAMESPACES", JSON.stringify(["/api/tasks"]));
    vi.stubEnv("DEVHUB_BIND_HOST", "127.0.0.1");
    try {
      runtime.routes = [
        { path: "/start", method: "POST" }, { path: "/background", method: "POST", stream: true },
        { path: "/check", method: "GET" }, { path: "/stream", method: "GET", stream: true },
      ];
      runtime.aliases = [
        { kind: "api", path: "/api/fixture-run", target: "/start", method: "POST" },
        { kind: "api", path: "/api/fixture-stream/[runId]", target: "/stream", method: "GET", preflight: "/check" },
      ];
      runtime.capabilities = { approvals: [{ path: "/start", method: "POST" }], backgroundRuns: [{ path: "/start", method: "POST", runRoute: "/background" }] };
      fs.writeFileSync(path.join(source, runtime.entry), `import fs from "node:fs";let data="";for await(const part of process.stdin)data+=part;const req=JSON.parse(data);const send=x=>process.stdout.write(JSON.stringify(x)+"\\n");if(req.path==="/start"){const d=req.hostApproval;process.stdout.write(JSON.stringify(!d?{status:202,body:{ok:true},hostApproval:{id:"fixture",summary:"Review fixture run",payload:{value:req.body.body.value}}}:d.status==="approved"?{status:202,body:{ok:true},hostBackgroundRun:true}:{status:202,body:{pending:true}}));}else if(req.path==="/background"){if(req.hostApproval?.status!=="approved")process.exit(1);send({type:"output",text:"__DEVHUB_RUN_READY__"});await new Promise(r=>setTimeout(r,500));fs.writeFileSync("finished",req.body.runId);send({type:"result",result:{ok:true}});}else if(req.path==="/check")process.stdout.write(JSON.stringify({status:200,body:{ok:true}}));else{send({type:"output",text:"fixture output"});send({type:"result",result:{status:200,body:{exitCode:0}}});}`);
      runtime.sha256 = hashFile(path.join(source, runtime.entry));
      fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(manifest));
      const review = await prepareLocal(ctx, source);
      await confirmOperation(ctx, review.id, consent(review));
      const headers = { host: "localhost:1437", origin: "http://localhost:1437", "content-type": "application/json" };
      const call = (body: unknown) => handleRuntimeAlias(new Request("http://localhost:1437/api/fixture-run", { method: "POST", headers, body: JSON.stringify(body) }), ctx);
      const first = await (await call({ value: "reviewed" })).json();
      resolveTerminalProposal(first.hostApproval.proposalId, "approve");
      const result = await call({ value: "reviewed", hostApprovalId: first.hostApproval.proposalId });
      expect(result.status).toBe(202);
      const { runId } = await result.json();
      expect(runId).toMatch(/^[a-f0-9-]{36}$/);
      const data = path.join(ctx.paths.pluginHome, "runtime-data", loadRuntime(ctx, "sample-tools").id);
      expect(fs.existsSync(path.join(data, "finished"))).toBe(false);
      const stream = await handleRuntimeAlias(new Request(`http://localhost:1437/api/fixture-stream/${runId}`, { headers }), ctx);
      expect(stream.headers.get("content-type")).toContain("text/event-stream");
      expect(await stream.text()).toBe('data: "fixture output"\n\nevent: done\ndata: 0\n\n');
      expect((await call({ value: "reviewed", hostApprovalId: first.hostApproval.proposalId })).status).toBe(502);
      await new Promise(resolve => setTimeout(resolve, 700));
      expect(fs.readFileSync(path.join(data, "finished"), "utf8")).toBe(runId);
    } finally { vi.unstubAllEnvs(); }
  });

  it("reviews and enforces bounded MCP deadlines", async () => {
    const { ctx, source, manifest, runtime } = fixture();
    const server = { name: "sample", description: "Fixture tools", timeoutSeconds: 120 };
    expect(runtimeSchema.safeParse({ ...runtime, mcp: [{ ...server, timeoutSeconds: 29 }] }).success).toBe(false);
    expect(runtimeSchema.safeParse({ ...runtime, mcp: [{ ...server, timeoutSeconds: 901 }] }).success).toBe(false);
    const previous = structuredClone(runtime);
    runtime.mcp = [server];
    expect(permissionChanges(previous, runtime)).toContain("mcp");
    fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(manifest));
    const review = await prepareLocal(ctx, source);
    expect(review.preview?.inventory.find(group => group.kind === "MCP servers and commands")?.entries).toEqual(expect.arrayContaining([expect.stringContaining("120s limit")]));
    await confirmOperation(ctx, review.id, consent(review));
    const externalCall = vi.spyOn(external, "execExternal");
    await invokeRuntime(ctx, "sample-tools", { kind: "mcp", path: "sample", method: "POST", body: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(externalCall.mock.calls.at(-1)?.[2]?.timeoutMs).toBe(120000);
  });

  it("rejects changed bytes both before consent and on later execution", async () => {
    const { ctx, source } = fixture();
    const review = await prepareLocal(ctx, source);
    await confirmOperation(ctx, review.id, consent(review));
    const installed = loadRuntime(ctx, "sample-tools");
    fs.appendFileSync(path.join(installed.root, "worker.mjs"), "\n// changed");
    expect(() => loadRuntime(ctx, "sample-tools")).toThrow(/changed/);
    fs.appendFileSync(path.join(source, "worker.mjs"), "\n// changed");
    const next = await prepareLocal(ctx, source);
    expect(next.preview?.canApply).toBe(false);
  });

  it("enforces ordinary filesystem and subprocess restrictions in the real child", async () => {
    const { ctx, source, manifest, runtime, root } = fixture();
    const outside = path.join(root, "unrelated.txt");
    fs.writeFileSync(outside, "fixture");
    fs.writeFileSync(path.join(source, runtime.entry), `import fs from 'node:fs'; import { spawnSync } from 'node:child_process'; let file, exec; try { fs.readFileSync(${JSON.stringify(outside)}); file='allowed'; } catch(e) { file=e.code; } try { spawnSync('/bin/echo',['test']); exec='allowed'; } catch(e) { exec=e.code; } process.stdout.write(JSON.stringify({file,exec,leaked:process.env.OTHER_SECRET??null}));`);
    runtime.sha256 = hashFile(path.join(source, runtime.entry));
    fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(manifest));
    ctx.env.OTHER_SECRET = "fixture";
    const review = await prepareLocal(ctx, source);
    await confirmOperation(ctx, review.id, consent(review));
    expect(await invokeRuntime(ctx, "sample-tools", { kind: "api", path: "/status", method: "GET" })).toEqual({ file: "ERR_ACCESS_DENIED", exec: "ERR_ACCESS_DENIED", leaked: null });
  });

  it("opens a fixture socket only with the reviewed network grant on supported Node versions", async () => {
    const server = net.createServer((socket) => socket.end());
    await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
    try {
      const port = (server.address() as net.AddressInfo).port;
      for (const permitted of [false, true]) {
        const { ctx, source, manifest, runtime } = fixture();
        runtime.permissions.network = permitted ? ["127.0.0.1"] : [];
        fs.writeFileSync(path.join(source, runtime.entry), `import net from "node:net";
          try { const socket=net.connect(${port}, "127.0.0.1"); socket.on("connect",()=>{socket.destroy();process.stdout.write(JSON.stringify({network:"allowed"}));}); socket.on("error",error=>process.stdout.write(JSON.stringify({network:error.code}))); }
          catch(error) { process.stdout.write(JSON.stringify({network:error.code})); }`);
        runtime.sha256 = hashFile(path.join(source, runtime.entry));
        fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(manifest));
        const review = await prepareLocal(ctx, source);
        await confirmOperation(ctx, review.id, consent(review));
        const network = permitted || !process.allowedNodeEnvironmentFlags.has("--allow-net") ? "allowed" : "ERR_ACCESS_DENIED";
        expect(await invokeRuntime(ctx, "sample-tools", { kind: "api", path: "/status", method: "GET" })).toEqual({ network });
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("offers and closes scoped data sync only for reviewed loopback slots", async () => {
    const { ctx, source, manifest, runtime } = fixture();
    runtime.permissions.network = ["127.0.0.1"];
    runtime.capabilities = { slots: [{ id: "setup", location: "setup", label: "Fixture setup", routes: [{ path: "/save", method: "POST", confirmation: "Save fixture?" }] }] };
    fs.writeFileSync(path.join(source, runtime.entry), `import fs from 'node:fs';import net from 'node:net';
      const value=process.env.DEVHUB_RUNTIME_DATA_SYNC;
      if(!value){process.stdout.write(JSON.stringify({available:false}));}else{
        const endpoint=JSON.parse(value);fs.writeFileSync('record','fixture');
        const response=await new Promise((resolve,reject)=>{const socket=net.connect(endpoint.port,'127.0.0.1');let text='';socket.on('connect',()=>socket.write(JSON.stringify({token:endpoint.token,path:'record'})+'\\n'));socket.on('data',chunk=>text+=chunk);socket.on('end',()=>resolve(JSON.parse(text)));socket.on('error',reject);});
        process.stdout.write(JSON.stringify({available:true,synced:response.ok,port:endpoint.port}));
      }`);
    runtime.sha256 = hashFile(path.join(source, runtime.entry));
    fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(manifest));
    const review = await prepareLocal(ctx, source);
    await confirmOperation(ctx, review.id, consent(review));
    expect(await invokeRuntime(ctx, "sample-tools", { kind: "api", path: "/status", method: "GET" })).toEqual({ available: false });
    const result = await invokeRuntime(ctx, "sample-tools", { kind: "slot", path: "setup", method: "POST", body: { action: { path: "/save", method: "POST" } } }) as { available: boolean; synced: boolean; port: number };
    expect(result).toMatchObject({ available: true, synced: true });
    await expect(new Promise<void>((resolve, reject) => {
      const socket = net.connect(result.port, "127.0.0.1");
      socket.once("connect", () => { socket.destroy(); resolve(); });
      socket.once("error", reject);
    })).rejects.toThrow();
  });

  it("cancels active workers on disable and never exposes child output", async () => {
    const { ctx, source } = fixture();
    const review = await prepareLocal(ctx, source);
    await confirmOperation(ctx, review.id, consent(review));
    vi.spyOn(external, "execExternal").mockImplementation(async (_file, _args, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new Error("private credential in stderr")))));
    const pending = invokeRuntime(ctx, "sample-tools", { kind: "api", path: "/status", method: "GET" });
    const failure = expect(pending).rejects.toThrow("Plugin request failed");
    const disable = await startLifecycle(ctx, "sample-tools", "disable");
    await confirmOperation(ctx, disable.id, consent(disable));
    await failure;
  });

  it("grants only reviewed vault folders, keeps read-only scopes and retains notes on disable", async () => {
    const { ctx, source, manifest, runtime, root } = fixture();
    const notes = path.join(root, "vault");
    fs.mkdirSync(path.join(notes, "one-on-ones"), { recursive: true });
    fs.writeFileSync(path.join(notes, "other.json"), "unrelated note");
    ctx.env.NOTES_DIR = notes;
    runtime.permissions.notes = [{ path: "appraisal", write: true }, { path: "one-on-ones", write: false }];
    fs.writeFileSync(path.join(source, runtime.entry), `import fs from 'node:fs'; import path from 'node:path';
      const scopes=JSON.parse(process.env.DEVHUB_PLUGIN_NOTE_SCOPES);
      const appraisal=scopes.find(s=>s.path==='appraisal').root;
      const meeting=scopes.find(s=>s.path==='one-on-ones').root;
      fs.writeFileSync(path.join(appraisal,'retained.json'),'[]');
      let outside,readOnly;
      try { fs.readFileSync(${JSON.stringify(path.join(notes, "other.json"))}); outside='allowed'; } catch(e) { outside=e.code; }
      try { fs.writeFileSync(path.join(meeting,'blocked.json'),'[]'); readOnly='allowed'; } catch(e) { readOnly=e.code; }
      process.stdout.write(JSON.stringify({outside,readOnly}));`);
    runtime.sha256 = hashFile(path.join(source, runtime.entry));
    fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(manifest));
    const review = await prepareLocal(ctx, source);
    expect(review.preview?.inventory.find(group => group.kind === "Notes vault access")?.entries).toEqual([
      expect.stringContaining("appraisal/: read and write"), expect.stringContaining("one-on-ones/: read only"),
    ]);
    await confirmOperation(ctx, review.id, consent(review));
    expect(await invokeRuntime(ctx, "sample-tools", { kind: "api", path: "/status", method: "GET" })).toEqual({ outside: "ERR_ACCESS_DENIED", readOnly: "ERR_ACCESS_DENIED" });
    const disable = await startLifecycle(ctx, "sample-tools", "disable");
    await confirmOperation(ctx, disable.id, consent(disable));
    expect(fs.readFileSync(path.join(notes, "appraisal/retained.json"), "utf8")).toBe("[]");
    expect(fs.readFileSync(path.join(notes, "other.json"), "utf8")).toBe("unrelated note");
    expect(fs.readdirSync(path.join(notes, "one-on-ones"))).toEqual([]);
  });

  it("refuses a symlinked notes scope before starting a worker", async () => {
    const { ctx, source, manifest, runtime, root } = fixture();
    const notes = path.join(root, "vault");
    const outside = path.join(root, "outside");
    fs.mkdirSync(notes); fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(notes, "appraisal"));
    ctx.env.NOTES_DIR = notes;
    runtime.permissions.notes = [{ path: "appraisal", write: true }];
    fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(manifest));
    const review = await prepareLocal(ctx, source);
    await confirmOperation(ctx, review.id, consent(review));
    const run = vi.spyOn(external, "execExternal");
    await expect(invokeRuntime(ctx, "sample-tools", { kind: "api", path: "/status", method: "GET" })).rejects.toThrow(/safe regular path/);
    expect(run).not.toHaveBeenCalled();
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("grants reviewed retained state without exposing sibling files and preserves it on disable", async () => {
    const { ctx, source, manifest, runtime, root } = fixture();
    ctx.env.DEVHUB_DESKTOP = "1";
    ctx.env.DEVHUB_STATE_PROFILE = "0123456789abcdef";
    ctx.env.XDG_STATE_HOME = path.join(root, "custom-state");
    const profile = path.join(root, ".local/state/devhub/profiles/0123456789abcdef/workflow-alerts/slack");
    const gateway = path.join(root, "custom-state/devhub/slack");
    fs.mkdirSync(profile, { recursive: true });
    fs.mkdirSync(gateway, { recursive: true });
    fs.writeFileSync(path.join(profile, "threads.json"), "retained");
    fs.writeFileSync(path.join(root, "custom-state/devhub/private"), "private");
    runtime.permissions.state = [
      { id: "slack-state", root: "profile", path: "workflow-alerts/slack", write: true },
      { id: "slack-gateway", root: "xdg", path: "devhub/slack", write: true },
    ];
    fs.writeFileSync(path.join(source, runtime.entry), `import fs from 'node:fs'; import path from 'node:path';
      const scopes=JSON.parse(process.env.DEVHUB_PLUGIN_STATE_SCOPES);
      const state=scopes.find(scope=>scope.id==='slack-state').root;
      const gateway=scopes.find(scope=>scope.id==='slack-gateway').root;
      fs.writeFileSync(path.join(gateway,'identity'),'fixture');
      let outside; try { fs.readFileSync(${JSON.stringify(path.join(root, "custom-state/devhub/private"))}); outside='allowed'; } catch(error) { outside=error.code; }
      process.stdout.write(JSON.stringify({state,gateway,threads:fs.readFileSync(path.join(state,'threads.json'),'utf8'),outside}));`);
    runtime.sha256 = hashFile(path.join(source, runtime.entry));
    fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(manifest));
    const review = await prepareLocal(ctx, source);
    expect(review.preview?.inventory.find(group => group.kind === "Retained state access")?.entries).toHaveLength(2);
    await confirmOperation(ctx, review.id, consent(review));
    expect(await invokeRuntime(ctx, "sample-tools", { kind: "api", path: "/status", method: "GET" })).toEqual({ state: profile, gateway, threads: "retained", outside: "ERR_ACCESS_DENIED" });
    const disable = await startLifecycle(ctx, "sample-tools", "disable");
    await confirmOperation(ctx, disable.id, consent(disable));
    expect(fs.readFileSync(path.join(profile, "threads.json"), "utf8")).toBe("retained");
    expect(fs.readFileSync(path.join(gateway, "identity"), "utf8")).toBe("fixture");
  });

  it("rejects unsafe, duplicate and symlinked state grants", async () => {
    const { ctx, source, manifest, runtime, root } = fixture();
    const grant = { id: "slack-state", root: "profile" as const, path: "workflow-alerts/slack", write: true };
    for (const scopes of [[{ ...grant, path: "../outside" }], [grant, grant]]) {
      expect(runtimeSchema.safeParse({ ...runtime, permissions: { ...runtime.permissions, state: scopes } }).success).toBe(false);
    }
    const parent = path.join(root, ".local/state/devhub/workflow-alerts");
    const outside = path.join(root, "outside");
    fs.mkdirSync(parent, { recursive: true }); fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(parent, "slack"));
    runtime.permissions.state = [grant];
    fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(manifest));
    const review = await prepareLocal(ctx, source);
    await confirmOperation(ctx, review.id, consent(review));
    const run = vi.spyOn(external, "execExternal");
    await expect(invokeRuntime(ctx, "sample-tools", { kind: "api", path: "/status", method: "GET" })).rejects.toThrow(/safe regular path/);
    expect(run).not.toHaveBeenCalled();
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("requires a configured vault in injected contexts and rejects unsafe or duplicate grants", async () => {
    const { ctx, source, manifest, runtime } = fixture();
    runtime.permissions.notes = [{ path: "appraisal", write: true }];
    for (const scopes of [[{ path: "../appraisal", write: true }], [{ path: "appraisal/people", write: true }], [...runtime.permissions.notes, ...runtime.permissions.notes]]) {
      expect(runtimeSchema.safeParse({ ...runtime, permissions: { ...runtime.permissions, notes: scopes } }).success).toBe(false);
    }
    fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(manifest));
    const review = await prepareLocal(ctx, source);
    await confirmOperation(ctx, review.id, consent(review));
    await expect(invokeRuntime(ctx, "sample-tools", { kind: "api", path: "/status", method: "GET" })).rejects.toMatchObject({ code: "RUNTIME_NOTES" });
  });

  it("cancels an active action on replacement without replaying its data write", async () => {
    const { ctx, source, manifest, runtime } = fixture();
    runtime.routes = [{ path: "/run", method: "POST", stream: true }];
    fs.writeFileSync(path.join(source, runtime.entry), 'import fs from "node:fs"; fs.appendFileSync("actions.log", "once\\n"); process.stdout.write(JSON.stringify({type:"output",text:"started"})+"\\n"); setTimeout(()=>process.stdout.write(JSON.stringify({type:"result",result:"old"})+"\\n"), 10000);');
    runtime.sha256 = hashFile(path.join(source, runtime.entry));
    fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(manifest));
    const initial = await prepareLocal(ctx, source);
    await confirmOperation(ctx, initial.id, consent(initial));
    const previous = loadRuntime(ctx, "sample-tools");
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const pending = invokeRuntime(ctx, "sample-tools", { kind: "api", path: "/run", method: "POST" }, undefined, () => started());
    const failed = expect(pending).rejects.toMatchObject({ code: "RUNTIME_FAILED" });
    await ready;
    fs.writeFileSync(path.join(source, runtime.entry), 'process.stdout.write(JSON.stringify({type:"result",result:"new"})+"\\n");');
    runtime.sha256 = hashFile(path.join(source, runtime.entry));
    fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(manifest));
    const update = await prepareLocal(ctx, source, { reviewRuntimeReplacement: true });
    expect((await confirmOperation(ctx, update.id, consent(update))).state).toBe("succeeded");
    await failed;
    expect(await invokeRuntime(ctx, "sample-tools", { kind: "api", path: "/run", method: "POST" })).toBe("new");
    await confirmOperation(ctx, update.id, consent(update));
    expect(fs.readFileSync(path.join(ctx.paths.pluginHome, "runtime-data", previous.id, "actions.log"), "utf8")).toBe("once\n");
    expect(fs.existsSync(previous.root)).toBe(true);
  });

  it("scopes the environment and rejects runtime injection controls", () => {
    const { runtime, root } = fixture();
    const saved = vi.spyOn(dashboardEnv, "readDashboardEnvLocalFile").mockReturnValue({ overrides: new Map([["AWS_PROFILE", "saved-profile"], ["SAMPLE_TOKEN", "saved-private-value"], ["OTHER_SECRET", "unreviewed-private-value"]]), passthrough: [] });
    runtime.permissions.env = ["SAMPLE_TOKEN"];
    runtime.permissions.publicEnv = ["AWS_PROFILE"];
    const scoped = runtimeEnvironment(runtime, { NODE_ENV: "test", SAMPLE_TOKEN: "fixture", OTHER_SECRET: "never", NODE_OPTIONS: "--require evil", PATH: "/evil", DEVHUB_API_SECRET: "never" }, root);
    expect(scoped.SAMPLE_TOKEN).toBe("fixture");
    expect(scoped.OTHER_SECRET).toBeUndefined();
    expect(scoped.NODE_OPTIONS).toBeUndefined();
    expect(scoped.DEVHUB_API_SECRET).toBeUndefined();
    expect(scoped.HOME).toBe(root);
    expect(scoped.PATH).not.toContain("evil");
    expect(runtimeEnvironment(runtime, { NODE_ENV: "test", AWS_PROFILE: "prd-example+" }, root).AWS_PROFILE).toBe("prd-example+");
    expect(runtimeEnvironment(runtime, { NODE_ENV: "test", SAMPLE_TOKEN: " fixture value " }, root).SAMPLE_TOKEN).toBe(" fixture value ");
    expect(scoped.AWS_PROFILE).toBeUndefined();
    expect(saved).not.toHaveBeenCalled();
    const host = runtimeEnvironment(runtime, process.env, root);
    expect(host.AWS_PROFILE).toBe("saved-profile");
    expect(host.SAMPLE_TOKEN).toBe("saved-private-value");
    expect(host.OTHER_SECRET).toBeUndefined();
    expect(runtimeSchema.safeParse({ ...runtime, permissions: { ...runtime.permissions, env: ["NODE_OPTIONS"] } }).success).toBe(false);
    for (const publicEnv of [["NODE_OPTIONS"], ["DATADOG_API_KEY"], ["ACCESS_TOKEN"], ["PASSWORD"], ["AWS_PROFILE", "AWS_PROFILE"], ["SAMPLE_TOKEN"]]) {
      expect(runtimeSchema.safeParse({ ...runtime, permissions: { ...runtime.permissions, publicEnv } }).success).toBe(false);
    }
    expect(runtimeSchema.safeParse({ ...runtime, permissions: { ...runtime.permissions, env: ["AWS_PROFILE"] } }).success).toBe(false);
    expect(permissionChanges(runtime, { ...runtime, permissions: { ...runtime.permissions, publicEnv: ["DD_SITE"] } })).toContain("permissions");
  });

  it("preserves reviewed command precedence without exposing unrelated PATH directories", async () => {
    const { ctx, source, manifest, runtime, root } = fixture();
    const first = path.join(root, "first");
    const second = path.join(root, "second");
    const unrelated = path.join(root, "unrelated");
    for (const directory of [first, second, unrelated]) fs.mkdirSync(directory);
    for (const file of [path.join(first, "aws"), path.join(second, "aws"), path.join(second, "safe-chain")]) fs.writeFileSync(file, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    ctx.env.PATH = [first, unrelated, second, path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter);
    manifest.requires = { commands: [{ command: "safe-chain", install: "Install safe-chain" }] };
    runtime.permissions.commands = ["aws"];
    fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(manifest));
    const review = await prepareLocal(ctx, source);
    await confirmOperation(ctx, review.id, consent(review));
    const options = runtimeWorkerOptions(ctx, loadRuntime(ctx, "sample-tools"));
    const environment: NodeJS.ProcessEnv = options.env;
    expect(whichOnPath("aws", environment)).toBe(path.join(first, "aws"));
    expect(environment.PATH?.split(path.delimiter)).not.toContain(unrelated);
  });

  it("allows only reviewed home writes and never grants the sibling file", async () => {
    const { ctx, source, manifest, runtime, root } = fixture();
    const config = path.join(root, ".aws");
    fs.mkdirSync(config);
    fs.writeFileSync(path.join(config, "config"), "old");
    fs.writeFileSync(path.join(config, "credentials"), "retain");
    runtime.permissions.write = ["~/.aws/config"];
    fs.writeFileSync(path.join(source, runtime.entry), `import fs from 'node:fs'; import path from 'node:path';
      const dir = path.join(process.env.DEVHUB_PLUGIN_HOST_HOME, '.aws');
      fs.writeFileSync(path.join(dir, 'config'), 'new');
      let denied; try { fs.writeFileSync(path.join(dir, 'credentials'), 'bad'); } catch (error) { denied = error.code; }
      process.stdout.write(JSON.stringify({denied}));`);
    runtime.sha256 = hashFile(path.join(source, runtime.entry));
    fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(manifest));
    const review = await prepareLocal(ctx, source);
    expect(review.preview?.inventory.find(group => group.kind === "Writable home paths")?.entries).toEqual(["~/.aws/config"]);
    await confirmOperation(ctx, review.id, consent(review));
    expect(await invokeRuntime(ctx, "sample-tools", { kind: "api", path: "/status", method: "GET" })).toEqual({ denied: "ERR_ACCESS_DENIED" });
    expect(fs.readFileSync(path.join(config, "config"), "utf8")).toBe("new");
    expect(fs.readFileSync(path.join(config, "credentials"), "utf8")).toBe("retain");
    for (const write of [["~/../escape"], ["~/"], ["~/.aws/../config"]]) expect(runtimeSchema.safeParse({ ...runtime, permissions: { ...runtime.permissions, write } }).success).toBe(false);
  });

  it("keeps the default list deadline unless a longer bounded cold load was reviewed", async () => {
    const { ctx, source, manifest, runtime } = fixture();
    runtime.capabilities = { database: { id: "sample", listTimeoutSeconds: 20 } };
    fs.writeFileSync(path.join(source, runtime.entry), 'process.stdout.write("[]");');
    runtime.sha256 = hashFile(path.join(source, runtime.entry));
    fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(manifest));
    const review = await prepareLocal(ctx, source);
    await confirmOperation(ctx, review.id, consent(review));
    const run = vi.spyOn(external, "execExternal");
    expect(await invokeRuntime(ctx, "sample-tools", { kind: "database", path: "list", method: "POST" })).toEqual([]);
    expect(run.mock.calls.at(-1)?.[2]?.timeoutMs).toBe(20000);
    for (const listTimeoutSeconds of [0, 31, 3.5]) expect(runtimeSchema.safeParse({ ...runtime, capabilities: { database: { id: "sample", listTimeoutSeconds } } }).success).toBe(false);
  });

  it("confines files, requires lockfiles, and detects permission widening", () => {
    const { runtime, source, root } = fixture();
    expect(() => verifyRuntimeFiles(source, runtime)).not.toThrow();
    expect(() => runtimeFile(source, "../outside.mjs")).toThrow();
    fs.symlinkSync(root, path.join(source, "escape"));
    expect(() => runtimeFile(source, "escape/source/worker.mjs")).toThrow();
    const widened = { ...runtime, permissions: { ...runtime.permissions, exec: true } };
    expect(permissionChanges(runtime, widened)).toContain("permissions");
    expect(permissionChanges(runtime, runtime)).toEqual([]);
    const withoutBrand = { ...runtime };
    delete withoutBrand.branding;
    expect(permissionChanges(runtime, withoutBrand)).toContain("branding");
    expect(runtimeSchema.safeParse({ ...runtime, api: "2" }).success).toBe(false);
    expect(runtimeSchema.safeParse({ ...runtime, pages: [...runtime.pages, ...runtime.pages] }).success).toBe(false);
    fs.writeFileSync(path.join(source, "package-lock.json"), "{}");
    runtime.lockfile.sha256 = hashFile(path.join(source, "package-lock.json"));
    expect(() => verifyRuntimeFiles(source, runtime)).toThrow(/lockfile/);
  });
});
