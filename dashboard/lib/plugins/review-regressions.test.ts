import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { pluginContext } from "./context";
import { hashFile, hashSkillDir, inspectPluginDir } from "./inspect";
import { cleanupReceipt } from "./install";
import { decideManagement } from "./management-auth";
import { cancelOperation, confirmOperation, getOperation, listRegistrations, prepareLocal, retryCleanup, startLifecycle, unfinishedOperations } from "./operations";
import { readReceipt, readStored, requestCancellation, save, writeReceipt } from "./store";
import { pluginOriginGuard, managedTargetPaths } from "./origin-guard";
import { registerPlugin, setPluginEnabled } from "./registry-write";
import { resolvePluginPaths } from "./paths";
import { listenerHost } from "./listener";
import { blocksPluginManagement, dashboardLanProxy } from "./lan-proxy";
import { readJson } from "./http";
import { parseGitHubRepoUrl } from "./github-url";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { syncSkills } from "../sync/skills";
import { syncAgents } from "../sync/agents";
import { listEnabledPlugins } from "./registry";
import { writePluginTemplate } from "./templates";
import { cleanScratch, scratchDir } from "./test-fixtures";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); cleanScratch(); });

function fixture() {
  const root = scratchDir();
  const env = {
    NODE_ENV: "test" as const,
    PATH: process.env.PATH,
    DEVHUB_CONFIG_DIR: path.join(root, "config"),
    DEVHUB_PLUGIN_HOME: path.join(root, "managed"),
    DEVHUB_PLUGIN_TARGET_HOME: path.join(root, "targets"),
  };
  const ctx = pluginContext({ home: root, env, repoRoot: path.join(root, "core") });
  const source = path.join(root, "source");
  writePluginTemplate(source, { name: "team-tools" });
  return { root, source, ctx };
}

async function reviewed() {
  const f = fixture();
  const view = await prepareLocal(f.ctx, f.source);
  return { ...f, view, body: { revision: view.preview!.revision, planDigest: view.preview!.planDigest, selectedTargets: ["claude"], accepted: true } };
}

describe("review security regressions", () => {
  it("binds approval to files outside the asset directories", async () => {
    const { ctx, view, body } = await reviewed();
    const tree = readStored(ctx, view.id).internal.workTree!;
    const pkg = path.join(tree, "mcp-servers", "unreviewed");
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, "package.json"), '{"scripts":{"postinstall":"exit 1"}}');
    await expect(confirmOperation(ctx, view.id, body)).rejects.toMatchObject({ code: "PREVIEW_STALE" });
    expect(listRegistrations(ctx).plugins).toEqual([]);
  });

  it("does not write through a symlinked tool folder", async () => {
    const { root, ctx, view, body } = await reviewed();
    const outside = path.join(root, "outside");
    fs.mkdirSync(outside);
    fs.mkdirSync(ctx.paths.targetHome);
    fs.symlinkSync(outside, path.join(ctx.paths.targetHome, ".claude"));
    await expect(confirmOperation(ctx, view.id, body)).rejects.toMatchObject({ code: "PREVIEW_STALE" });
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("keeps a receipt target when a parent is replaced by a symlink", () => {
    const { root, ctx } = fixture();
    const outside = path.join(root, "outside");
    fs.mkdirSync(outside);
    const file = path.join(outside, "agent.md");
    fs.writeFileSync(file, "original");
    fs.mkdirSync(ctx.paths.targetHome);
    fs.symlinkSync(outside, path.join(ctx.paths.targetHome, "agents"));
    const destination = path.join(ctx.paths.targetHome, "agents", "agent.md");
    const result = cleanupReceipt({ pluginId: "test", sha: null, planDigest: "test", files: [
      { kind: "agent", name: "agent", tool: "claude", destination, hash: hashFile(file) },
    ] }, ctx.paths.targetHome);
    expect(result.kept).toEqual([destination]);
    expect(fs.readFileSync(file, "utf8")).toBe("original");
  });

  it("keeps a skill with a newly added symlink or empty directory", () => {
    const { ctx } = fixture();
    const destination = path.join(ctx.paths.targetHome, "skill");
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, "SKILL.md"), "original");
    const hash = hashSkillDir(destination);
    fs.mkdirSync(path.join(destination, "local-notes"));
    fs.symlinkSync("SKILL.md", path.join(destination, "local-link"));
    expect(cleanupReceipt({ pluginId: "test", sha: null, planDigest: "test", files: [
      { kind: "skill", name: "skill", tool: "claude", destination, hash },
    ] }, ctx.paths.targetHome).kept).toEqual([destination]);
    expect(fs.existsSync(destination)).toBe(true);
  });

  it("refuses browser management when listener scope is unknown", () => {
    vi.stubEnv("DEVHUB_BOOTSTRAP_TOKEN", "");
    const req = new NextRequest("http://localhost:14567/api/plugins", { method: "POST", headers: { host: "localhost:14567", origin: "http://localhost:14567" } });
    expect(decideManagement(req, { NODE_ENV: "test" })).toEqual({ ok: false, status: 403 });
  });

  it("returns invalid for a contribution that is a file, rather than throwing", () => {
    const { source } = fixture();
    fs.rmSync(path.join(source, "skills"), { recursive: true });
    fs.writeFileSync(path.join(source, "skills"), "not a folder");
    expect(inspectPluginDir(source).fatal).toBe(true);
  });

  it("leaves a cancelled inspection cancelled after its scheduled continuation", async () => {
    const { source, ctx } = fixture();
    const pending = prepareLocal(ctx, source);
    const id = fs.readdirSync(path.join(ctx.paths.pluginHome, "operations"))[0].replace(/\.json$/, "");
    await cancelOperation(ctx, id);
    await pending;
    expect(getOperation(ctx, id).state).toBe("cancelled");
  });

  it("preserves another process's cancellation across a stale progress write", async () => {
    const { ctx, view, body } = await reviewed();
    const stale = readStored(ctx, view.id);
    requestCancellation(ctx, view.id);
    save(ctx, stale);
    expect(getOperation(ctx, view.id).state).toBe("cancelled");
    await expect(confirmOperation(ctx, view.id, body)).rejects.toMatchObject({ code: "CANCELLED" });
    expect(listRegistrations(ctx).plugins).toEqual([]);
  });

  it("rolls back target copies when saving the receipt fails", async () => {
    const { ctx, view, body } = await reviewed();
    fs.writeFileSync(path.join(ctx.paths.pluginHome, "receipts"), "not a directory");
    const result = await confirmOperation(ctx, view.id, body);
    expect(result.state).toBe("failed");
    expect(fs.existsSync(path.join(ctx.paths.targetHome, ".claude", "skills", "team-tools-example"))).toBe(false);
    expect(listRegistrations(ctx).plugins).toEqual([]);
  });

  it("keeps managed cleanup unavailable without an ownership receipt", async () => {
    const { ctx, view, body } = await reviewed();
    await confirmOperation(ctx, view.id, body);
    fs.unlinkSync(path.join(ctx.paths.pluginHome, "receipts", `${view.id}.json`));
    await expect(startLifecycle(ctx, view.id, "remove")).rejects.toMatchObject({ code: "MISSING_RECEIPT" });
  });

  it("recovers a pre-commit crash without silently enabling or deleting edited copies", async () => {
    const { ctx, view } = await reviewed();
    const unchanged = path.join(ctx.paths.targetHome, "agents", "unchanged.md");
    const edited = path.join(ctx.paths.targetHome, "agents", "edited.md");
    fs.mkdirSync(path.dirname(unchanged), { recursive: true });
    fs.writeFileSync(unchanged, "original");
    fs.writeFileSync(edited, "original");
    const files = [unchanged, edited].map((destination) => ({ kind: "agent" as const, name: "agent", tool: "claude", destination, hash: hashFile(destination) }));
    writeReceipt(ctx, { pluginId: view.id, sha: null, planDigest: view.preview!.planDigest, files });
    fs.writeFileSync(edited, "personal edit");
    const stored = readStored(ctx, view.id);
    stored.internal.pid = 2_147_483_646;
    stored.view.state = "applying";
    save(ctx, stored);
    expect(unfinishedOperations(ctx)[0].error).toMatchObject({ code: "INTERRUPTED", consequences: expect.arrayContaining(["1 recorded copies are unchanged; 1 need manual review."]) });
    expect(fs.existsSync(unchanged)).toBe(true);
    const result = await retryCleanup(ctx, view.id);
    expect(result.error?.code).toBe("CLEANED");
    expect(fs.existsSync(unchanged)).toBe(false);
    expect(fs.readFileSync(edited, "utf8")).toBe("personal edit");
    expect(listRegistrations(ctx).plugins).toEqual([]);
    expect(readReceipt(ctx, view.id)?.retainedPaths).toEqual([edited]);
  });

  it("does not let general sync or legacy CLI change a managed installation", async () => {
    const { ctx, source, view, body } = await reviewed();
    await confirmOperation(ctx, view.id, body);
    for (const [key, value] of Object.entries(ctx.env)) if (value) vi.stubEnv(key, value);
    expect(await pluginOriginGuard()("plugin:team-tools")).toBe(false);
    expect(managedTargetPaths().size).toBeGreaterThan(0);
    await expect(setPluginEnabled("team-tools", true, ctx.home, ctx.env)).rejects.toThrow(/Plugins/);
    await expect(registerPlugin(source, ctx.home, ctx.env)).rejects.toThrow(/managed/);
  });

  it("keeps edited copies protected after removal", async () => {
    const { ctx, view, body } = await reviewed();
    await confirmOperation(ctx, view.id, body);
    const destination = readReceipt(ctx, view.id)!.files[0].destination;
    fs.writeFileSync(path.join(destination, "local.md"), "my edit");
    const remove = await startLifecycle(ctx, view.id, "remove");
    await confirmOperation(ctx, remove.id, { revision: remove.preview!.revision, planDigest: remove.preview!.planDigest, selectedTargets: [], accepted: true });
    for (const [key, value] of Object.entries(ctx.env)) if (value) vi.stubEnv(key, value);
    expect(managedTargetPaths().has(destination)).toBe(true);
    vi.spyOn(os, "homedir").mockReturnValue(ctx.paths.targetHome);
    vi.stubEnv("AI_TOOLS_ROOT", path.join(ctx.home, "no-upstream"));
    fs.mkdirSync(path.join(ctx.repoRoot!, "skills/shared"), { recursive: true });
    fs.mkdirSync(path.join(ctx.repoRoot!, "agents/shared"), { recursive: true });
    await syncSkills({ repoRoot: ctx.repoRoot!, tool: "claude", prune: true, refreshAiTools: false, emit: () => undefined });
    await syncAgents({ repoRoot: ctx.repoRoot!, tool: "claude", prune: true, emit: () => undefined });
    expect(fs.readFileSync(path.join(destination, "local.md"), "utf8")).toBe("my edit");
  });

  it("never copies a managed plugin to an unapproved general-sync target", async () => {
    const { ctx, view, body } = await reviewed();
    await confirmOperation(ctx, view.id, body);
    for (const [key, value] of Object.entries(ctx.env)) if (value) vi.stubEnv(key, value);
    vi.spyOn(os, "homedir").mockReturnValue(ctx.paths.targetHome);
    vi.stubEnv("AI_TOOLS_ROOT", path.join(ctx.home, "no-upstream"));
    fs.mkdirSync(path.join(ctx.repoRoot!, "skills/shared"), { recursive: true });
    fs.mkdirSync(path.join(ctx.repoRoot!, "agents/shared"), { recursive: true });
    await syncSkills({ repoRoot: ctx.repoRoot!, tool: "codex", refreshAiTools: false, emit: () => undefined });
    await syncAgents({ repoRoot: ctx.repoRoot!, tool: "codex", emit: () => undefined });
    expect(fs.existsSync(path.join(ctx.paths.targetHome, ".codex/skills/team-tools-example"))).toBe(false);
    expect(fs.existsSync(path.join(ctx.paths.targetHome, ".codex/agents/team-tools-reviewer.md"))).toBe(false);
  });

  it("keeps preserved edits protected through disable, re-enable elsewhere and removal", async () => {
    const { ctx, view, body } = await reviewed();
    await confirmOperation(ctx, view.id, body);
    const destination = readReceipt(ctx, view.id)!.files[0].destination;
    fs.writeFileSync(path.join(destination, "local.md"), "my edit");
    for (const kind of ["disable", "enable", "remove"] as const) {
      const op = await startLifecycle(ctx, view.id, kind);
      await confirmOperation(ctx, op.id, { revision: op.preview!.revision, planDigest: op.preview!.planDigest, selectedTargets: kind === "enable" ? ["codex"] : [], accepted: true });
      expect(readReceipt(ctx, view.id)?.retainedPaths).toContain(destination);
    }
    expect(fs.readFileSync(path.join(destination, "local.md"), "utf8")).toBe("my edit");
  });

  it("handles a JSON null registry without crashing the tolerant loader", () => {
    const { ctx } = fixture();
    for (const [key, value] of Object.entries(ctx.env)) if (value) vi.stubEnv(key, value);
    fs.mkdirSync(ctx.paths.configDir, { recursive: true });
    fs.writeFileSync(ctx.paths.registryPath, "null");
    expect(listEnabledPlugins()).toEqual([]);
    expect(listRegistrations(ctx).malformed).toBe(true);
  });

  it("binds target approval to all skills and agent folders", async () => {
    const { view } = await reviewed();
    const target = view.preview!.targets.find((item) => item.id === "claude")!;
    expect(target.pathLabel).toContain(".claude/skills");
    expect(target.pathLabel).toContain(".claude/agents");
  });

  it("rejects encoded hostnames and Windows-mounted paths in WSL", () => {
    expect(parseGitHubRepoUrl("https://%67ithub.com/team/tools").ok).toBe(false);
    const { root, ctx } = fixture();
    for (const destination of ["C:\\plugins", "\\\\wsl.localhost\\Other\\plugins", "/mnt/c/plugins"]) {
      expect(() => resolvePluginPaths({ home: root, env: { ...ctx.env, WSL_DISTRO_NAME: "TestDistro", DEVHUB_PLUGIN_HOME: destination } })).toThrow(/WSL distro/);
    }
    expect(resolvePluginPaths({ home: root, env: { NODE_ENV: "test", WSL_DISTRO_NAME: "TestDistro" } }).pluginHome).toBe(path.join(root, ".local/share/devhub/plugins"));
  });

  it("accounts for Next hostname overrides", () => {
    for (const args of [["-H", "0.0.0.0"], ["--hostname", "0.0.0.0"], ["--hostname=0.0.0.0"], ["-H0.0.0.0"]]) {
      expect(listenerHost(args, "127.0.0.1")).toBe("0.0.0.0");
    }
    expect(listenerHost([], "127.0.0.1")).toBe("127.0.0.1");
  });

  it.each(["/api/plugins", "/api/plugins/operations/id/confirm", "/api/%70lugins", "//api//plugins", "/api%2fplugins", "/x/../api/plugins", "/api%5cplugins", "/api/%2570lugins"])("blocks plugin management at the LAN proxy: %s", (url) => {
    expect(blocksPluginManagement(url)).toBe(true);
    const server = dashboardLanProxy(14567);
    const req = Object.assign(new EventEmitter(), { url, headers: { host: "localhost", "x-devhub-secret": "valid-proof" } });
    const res = { writeHead: vi.fn(), end: vi.fn() };
    server.emit("request", req as unknown as IncomingMessage, res as unknown as ServerResponse);
    expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
    expect(res.end).toHaveBeenCalled();
    expect(blocksPluginManagement("/api/skills")).toBe(false);
  });

  it("forwards ordinary paths that contain a literal percent sign", () => {
    expect(blocksPluginManagement("/notes/50%25%20done")).toBe(false);
    expect(blocksPluginManagement("/notes/100%")).toBe(false);
    expect(blocksPluginManagement("/api/%2570lugins")).toBe(true);
    expect(blocksPluginManagement("/api/%252525252570lugins")).toBe(true);
  });

  it("bounds a chunked UTF-8 request without reading the entire body", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulled += 1; controller.enqueue(new TextEncoder().encode("é".repeat(40_000))); } });
    const req = { headers: new Headers(), body: stream } as NextRequest;
    await expect(readJson(req)).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
    expect(pulled).toBeLessThan(3);
  });
});
