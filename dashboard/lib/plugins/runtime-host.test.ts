import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as external from "@/lib/exec-external";
import { pluginContext } from "./context";
import { confirmOperation, prepareLocal, startLifecycle } from "./operations";
import { runtimeSchema, permissionChanges } from "./runtime-contract";
import { runtimeFile, verifyRuntimeFiles } from "./runtime-files";
import { invokeRuntime, loadRuntime, runtimeEnvironment } from "./runtime-host";
import { readManifest } from "./manifest";
import { hashFile } from "./inspect";
import type { PluginOperationView } from "./model";

const roots: string[] = [];
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "runtime-plugin-")));
  roots.push(root);
  const source = path.join(root, "source");
  fs.cpSync(path.resolve("../templates/runtime-plugin"), source, { recursive: true });
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
  it("reviews without execution, then serves a real page, API and MCP request from the installed copy", async () => {
    const { ctx, source } = fixture();
    const run = vi.spyOn(external, "execExternal");
    const review = await prepareLocal(ctx, source);
    expect(review.preview?.canApply).toBe(true);
    expect(review.preview?.inventory.some((group) => group.kind === "Environment and secrets")).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(() => loadRuntime(ctx, "sample-tools")).toThrow(/not enabled/);
    expect((await confirmOperation(ctx, review.id, consent(review))).state).toBe("succeeded");
    const page = await invokeRuntime(ctx, "sample-tools", { kind: "page", path: "/", method: "GET" });
    expect(page).toContain("Sample tools");
    expect(await invokeRuntime(ctx, "sample-tools", { kind: "api", path: "/status", method: "GET" })).toEqual({ message: "The plugin API is working." });
    const mcp = await invokeRuntime(ctx, "sample-tools", { kind: "mcp", path: "sample", method: "POST", body: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(mcp).toMatchObject({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "status" }] } });
    await expect(invokeRuntime(ctx, "sample-tools", { kind: "api", path: "/undeclared", method: "POST" })).rejects.toThrow(/did not declare/);
    const disable = await startLifecycle(ctx, "sample-tools", "disable");
    await confirmOperation(ctx, disable.id, consent(disable));
    expect(() => loadRuntime(ctx, "sample-tools")).toThrow(/not enabled/);
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

  it("scopes the environment and rejects runtime injection controls", () => {
    const { runtime, root } = fixture();
    runtime.permissions.env = ["SAMPLE_TOKEN"];
    const scoped = runtimeEnvironment(runtime, { NODE_ENV: "test", SAMPLE_TOKEN: "fixture", OTHER_SECRET: "never", NODE_OPTIONS: "--require evil", PATH: "/evil", DEVHUB_API_SECRET: "never" }, root);
    expect(scoped.SAMPLE_TOKEN).toBe("fixture");
    expect(scoped.OTHER_SECRET).toBeUndefined();
    expect(scoped.NODE_OPTIONS).toBeUndefined();
    expect(scoped.DEVHUB_API_SECRET).toBeUndefined();
    expect(scoped.HOME).toBe(root);
    expect(scoped.PATH).not.toContain("evil");
    expect(runtimeSchema.safeParse({ ...runtime, permissions: { ...runtime.permissions, env: ["NODE_OPTIONS"] } }).success).toBe(false);
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
