import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { execExternal } from "../exec-external";
import { runPluginsCli } from "../../scripts/plugins";
import { pluginContext } from "./context";
import { cancelOperation, confirmOperation, prepareLocal, startLifecycle } from "./operations";
import { registerPlugin } from "./registry-write";
import { PLUGIN_LIMITS } from "./source";
import { invokeRuntime, loadRuntime } from "./runtime-host";
import { getRegistration, listRegistrations } from "./views";
import { reviewedFixtures, writeReviewedFixture } from "./__fixtures__/same-build";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "runtime-cli-")));
  roots.push(root);
  const source = path.join(root, "source");
  fs.cpSync(path.resolve("../../templates/runtime-plugin"), source, { recursive: true });
  const env = { NODE_ENV: "test" as const, DEVHUB_CONFIG_DIR: path.join(root, "config"), DEVHUB_PLUGIN_HOME: path.join(root, "managed"), DEVHUB_PLUGIN_TARGET_HOME: path.join(root, "targets"), INIT_CWD: root };
  let output = "";
  const io = { stdout: (chunk: string) => { output += chunk; }, stderr: (chunk: string) => { output += chunk; } };
  return { root, source, env, ctx: pluginContext({ env }), io, output: () => output };
}

async function review(f: ReturnType<typeof fixture>): Promise<string> {
  expect(await runPluginsCli(["add-runtime", "source"], f.io, f.env)).toBe(0);
  const digest = f.output().match(/--trust ([a-f0-9]{64})/)?.[1];
  if (!digest) throw new Error(f.output());
  return digest;
}

it("reviews each runtime fixture without registering or compiling it", async () => {
  const f = fixture();
  for (const kind of reviewedFixtures) {
    fs.rmSync(f.source, { recursive: true });
    writeReviewedFixture(f.source, kind);
    expect(await runPluginsCli(["add-runtime", "source"], f.io, f.env)).toBe(0);
    expect(f.output()).toContain(`Review fixture-${kind}`);
    expect(fs.existsSync(f.ctx.paths.registryPath)).toBe(false);
    expect(fs.readdirSync(path.join(f.env.DEVHUB_PLUGIN_HOME, "staging"))).toEqual([]);
  }
}, 30000);

it("refuses staged plugin manifests, materialisation receipts and icon copies", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "plugin-staging-")));
  roots.push(root);
  const scripts = path.join(root, "scripts");
  const staging = path.join(root, "staging");
  const resources = path.join(staging, "resources");
  const server = path.join(staging, "server");
  const dashboard = path.join(root, "apps/ui");
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(server, { recursive: true });
  fs.mkdirSync(path.join(resources, "skills/shared/my-voice"), { recursive: true });
  fs.mkdirSync(path.join(dashboard, "public"), { recursive: true });
  fs.copyFileSync(path.resolve("../desktop/scripts/verify-staging.mjs"), path.join(scripts, "verify-staging.mjs"));
  fs.writeFileSync(path.join(scripts, "staging-paths.mjs"), `export const repoRoot=${JSON.stringify(root)}, dashboardDir=${JSON.stringify(dashboard)}, stagingDir=${JSON.stringify(staging)}, resourcesDir=${JSON.stringify(resources)}, serverDir=${JSON.stringify(server)};`);
  fs.writeFileSync(path.join(scripts, "stage-resources.mjs"), 'export const GENERIC_WRITING_STYLE="generic"; export function isPersonalSourcePath() { return false; }');
  fs.writeFileSync(path.join(scripts, "stage-dashboard.mjs"), 'export async function verifyPayload() {}');
  fs.writeFileSync(path.join(scripts, "native-binaries.mjs"), 'export const NATIVE_BINARY_PATTERN=/\\.node$/; export function isMuslLinked() { return false; }');
  const style = "skills/shared/my-voice/writing-style.md";
  fs.writeFileSync(path.join(resources, style), "generic");
  fs.writeFileSync(path.join(resources, "MANIFEST.json"), JSON.stringify({ files: [{ path: style, sha256: crypto.createHash("sha256").update("generic").digest("hex") }] }));
  fs.writeFileSync(path.join(dashboard, "public/icon-master.png"), "core icon");
  const verify = () => execExternal(process.execPath, [path.join(scripts, "verify-staging.mjs")], { timeoutMs: 10000 });
  await expect(verify()).resolves.toMatchObject({ stdout: expect.stringContaining("Staging verified") });
  const manifest = path.join(server, "devhub-plugin.json");
  fs.writeFileSync(manifest, "{}");
  await expect(verify()).rejects.toMatchObject({ stderr: expect.stringContaining("devhub-plugin.json") });
  fs.unlinkSync(manifest);
  const receipt = path.join(server, "chunk.js");
  fs.writeFileSync(receipt, `const receipt={plugin:"fixture",sourceRoot:"/fixture",fingerprint:"${"a".repeat(64)}",files:[]};`);
  await expect(verify()).rejects.toMatchObject({ stderr: expect.stringContaining("chunk.js") });
  fs.unlinkSync(receipt);
  fs.mkdirSync(path.join(staging, "icons"));
  fs.writeFileSync(path.join(staging, "icons/plugin.png"), "plugin icon");
  await expect(verify()).rejects.toMatchObject({ stderr: expect.stringContaining("icons/plugin.png") });
}, 30000);

it("registers a reviewed local runtime without compiling its dashboard and disables it immediately", async () => {
  const f = fixture();
  const digest = await review(f);
  expect(fs.existsSync(f.ctx.paths.registryPath)).toBe(false);
  expect(fs.readdirSync(path.join(f.env.DEVHUB_PLUGIN_HOME, "staging"))).toEqual([]);
  expect(() => loadRuntime(f.ctx, "sample-tools")).toThrow(/not enabled/);
  expect(await runPluginsCli(["add-runtime", "source", "--trust", digest], f.io, f.env)).toBe(0);
  expect(getRegistration(f.ctx, "sample-tools")).toMatchObject({ managed: true, runtime: true, canDisable: true });
  vi.stubEnv("DEVHUB_CONFIG_DIR", f.env.DEVHUB_CONFIG_DIR);
  expect(await invokeRuntime(f.ctx, "sample-tools", { kind: "page", path: "/", method: "GET" })).toContain("Sample tools");
  fs.appendFileSync(path.join(f.source, "worker.mjs"), "\n// local edits do not alter the approved snapshot");
  expect(await invokeRuntime(f.ctx, "sample-tools", { kind: "api", path: "/status", method: "GET" })).toEqual({ message: "The plugin API is working." });
  const disable = await startLifecycle(f.ctx, "sample-tools", "disable");
  if (!disable.preview) throw new Error("Missing disable review");
  await confirmOperation(f.ctx, disable.id, { accepted: true, revision: disable.preview.revision, planDigest: disable.preview.planDigest, selectedTargets: [] });
  expect(() => loadRuntime(f.ctx, "sample-tools")).toThrow(/not enabled/);
});

it("refuses stale consent and reviews a legacy registration without changing it", async () => {
  const f = fixture();
  const digest = await review(f);
  fs.appendFileSync(path.join(f.source, "README.md"), "\nChanged after review.\n");
  expect(await runPluginsCli(["add-runtime", "source", "--trust", digest], f.io, f.env)).toBe(1);
  expect(f.output()).toContain("changed");
  expect(fs.existsSync(f.ctx.paths.registryPath)).toBe(false);
  const legacy = path.join(f.root, "legacy");
  fs.cpSync(f.source, legacy, { recursive: true });
  const file = path.join(legacy, "devhub-plugin.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  delete manifest.runtime;
  fs.writeFileSync(file, JSON.stringify(manifest));
  await registerPlugin(legacy, f.ctx.home, f.env);
  const registry = fs.readFileSync(f.ctx.paths.registryPath, "utf8");
  const source = fs.readFileSync(file, "utf8");
  expect(await runPluginsCli(["add-runtime", "source"], f.io, f.env)).toBe(0);
  expect(f.output()).toContain("Keep plugin ID: sample-tools");
  expect(f.output()).toContain("Legacy source has no reviewed runtime permissions");
  expect(f.output()).toContain("Candidate tree SHA-256:");
  expect(fs.readFileSync(file, "utf8")).toBe(source);
  expect(fs.readFileSync(f.ctx.paths.registryPath, "utf8")).toBe(registry);
  expect(fs.readdirSync(path.join(f.env.DEVHUB_PLUGIN_HOME, "staging"))).toEqual([]);
  expect(fs.existsSync(path.join(f.env.DEVHUB_PLUGIN_HOME, "repos"))).toBe(false);
  const unnamed = JSON.parse(registry);
  delete unnamed.plugins[0].name;
  const unnamedBytes = JSON.stringify(unnamed);
  fs.writeFileSync(f.ctx.paths.registryPath, unnamedBytes);
  const retainedId = listRegistrations(f.ctx).plugins[0].id;
  expect(retainedId).toMatch(/^folder-/);
  expect(await runPluginsCli(["add-runtime", "source"], f.io, f.env)).toBe(0);
  expect(f.output()).toContain(`Keep plugin ID: ${retainedId}`);
  expect(fs.readFileSync(f.ctx.paths.registryPath, "utf8")).toBe(unnamedBytes);
});

it("replaces a disabled snapshot with reviewed bytes and permissions, keeping its ID and data", async () => {
  const f = fixture();
  const digest = await review(f);
  expect(await runPluginsCli(["add-runtime", "source", "--trust", digest], f.io, f.env)).toBe(0);
  const disable = await startLifecycle(f.ctx, "sample-tools", "disable");
  if (!disable.preview) throw new Error("Missing disable review");
  await confirmOperation(f.ctx, disable.id, { accepted: true, revision: disable.preview.revision, planDigest: disable.preview.planDigest, selectedTargets: [] });
  const registration = getRegistration(f.ctx, "sample-tools");
  const data = path.join(f.env.DEVHUB_PLUGIN_HOME, "runtime-data", registration.id, "state.json");
  fs.mkdirSync(path.dirname(data), { recursive: true });
  fs.writeFileSync(data, '{"keep":"current data"}\n');
  const approved = fs.readFileSync(path.join(registration.path, "worker.mjs"), "utf8");
  const file = path.join(f.source, "devhub-plugin.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  manifest.runtime.permissions.env = ["SAMPLE_TOKEN"];
  fs.appendFileSync(path.join(f.source, "worker.mjs"), "\n// reviewed update\n");
  manifest.runtime.sha256 = crypto.createHash("sha256").update(fs.readFileSync(path.join(f.source, "worker.mjs"))).digest("hex");
  fs.writeFileSync(file, JSON.stringify(manifest));
  const first = await prepareLocal(f.ctx, f.source, { reviewRuntimeReplacement: true });
  fs.appendFileSync(path.join(f.source, "README.md"), "\nChanged bytes\n");
  const second = await prepareLocal(f.ctx, f.source, { reviewRuntimeReplacement: true });
  expect(first.preview?.replacement).toMatchObject({ id: registration.id, enabled: false, managed: true });
  expect(first.preview?.replacement?.changes.join("\n")).toContain("SAMPLE_TOKEN");
  expect(first.preview?.replacement?.changes.join("\n")).toContain(manifest.runtime.sha256);
  expect(second.preview?.planDigest).not.toBe(first.preview?.planDigest);
  expect(second.preview?.replacement?.nextTreeHash).not.toBe(first.preview?.replacement?.nextTreeHash);
  if (!second.preview) throw new Error("Missing replacement review");
  expect(await runPluginsCli(["add-runtime", "source", "--trust", second.preview.planDigest], f.io, f.env)).toBe(0);
  expect(f.output()).toContain("Keep state: disabled");
  expect(f.output()).toContain("replaced; disabled");
  const replaced = getRegistration(f.ctx, "sample-tools");
  expect(replaced).toMatchObject({ id: registration.id, state: "disabled", canEnable: true });
  expect(replaced.path).not.toBe(registration.path);
  expect(() => loadRuntime(f.ctx, "sample-tools")).toThrow(/not enabled/);
  expect(fs.readFileSync(path.join(registration.path, "worker.mjs"), "utf8")).toBe(approved);
  expect(fs.readFileSync(data, "utf8")).toBe('{"keep":"current data"}\n');
  await cancelOperation(f.ctx, first.id);
  await cancelOperation(f.ctx, second.id);
});

it("refuses duplicate replacement targets and cleans up the review", async () => {
  const f = fixture();
  await registerPlugin(f.source, f.ctx.home, f.env);
  const registry = JSON.parse(fs.readFileSync(f.ctx.paths.registryPath, "utf8"));
  registry.plugins.push({ ...registry.plugins[0], id: "duplicate" });
  fs.writeFileSync(f.ctx.paths.registryPath, JSON.stringify(registry));
  const before = fs.readFileSync(f.ctx.paths.registryPath, "utf8");
  expect(await runPluginsCli(["add-runtime", "source"], f.io, f.env)).toBe(1);
  expect(f.output()).toContain("duplicate");
  expect(fs.readFileSync(f.ctx.paths.registryPath, "utf8")).toBe(before);
  expect(fs.readdirSync(path.join(f.env.DEVHUB_PLUGIN_HOME, "staging"))).toEqual([]);
});

it("refuses a source-only plugin and an invalid bundle before enabling anything", async () => {
  const f = fixture();
  fs.appendFileSync(path.join(f.source, "worker.mjs"), "\n// invalid pin");
  expect(await runPluginsCli(["add-runtime", "source"], f.io, f.env)).toBe(1);
  expect(f.output()).toContain("Ask the publisher for a prebuilt bundle and matching dependency lockfile");
  const file = path.join(f.source, "devhub-plugin.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  delete manifest.runtime;
  fs.writeFileSync(file, JSON.stringify(manifest));
  expect(await runPluginsCli(["add-runtime", "source"], f.io, f.env)).toBe(1);
  expect(fs.existsSync(f.ctx.paths.registryPath)).toBe(false);
  expect(f.output()).toContain("valid prebuilt runtime manifest");
});

it("bounds local staging before copying an oversized file and cleans up refused reviews", async () => {
  const f = fixture();
  const large = path.join(f.source, "oversized");
  fs.writeFileSync(large, "");
  fs.truncateSync(large, PLUGIN_LIMITS.maxFileBytes + 1);
  expect(await runPluginsCli(["add-runtime", "source"], f.io, f.env)).toBe(1);
  expect(f.output()).toContain("exceeds the local review limits");
  expect(fs.existsSync(f.ctx.paths.registryPath)).toBe(false);
  expect(fs.readdirSync(path.join(f.env.DEVHUB_PLUGIN_HOME, "staging"))).toEqual([]);
});
