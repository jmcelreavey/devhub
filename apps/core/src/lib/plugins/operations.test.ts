import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatAgentForTool } from "../agent/sync-format";
import { execExternal } from "../exec-external";
import { DESKTOP_COOKIE } from "../../local/terminal/bootstrap-auth";
import { PluginApiError } from "./context";
import { hashFile } from "./inspect";
import { cleanupReceipt } from "./install";
import { decideManagement } from "./management-auth";
import { readManifest } from "./manifest";
import {
  cancelOperation,
  confirmOperation,
  diagnosticsFor,
  getOperation,
  listRegistrations,
  operationSettled,
  pluginContext,
  prepareLocal,
  startLifecycle,
  startPrepare,
  waitForOperation,
  type PluginContext,
} from "./operations";
import { resolvePluginPaths } from "./paths";
import { registerPlugin, setPluginEnabled } from "./registry-write";
import * as registryWrite from "./registry-write";
import { invokeRuntime, loadRuntime } from "./runtime-host";
import { verifyRuntimeFiles } from "./runtime-files";
import { parseGitHubRepoUrl, type CommandRunner } from "./source";
import { blank, prepareSteps, readStored, save } from "./store";
import { renderPluginTemplate, writePluginTemplate } from "./templates";
import { runPluginsCli } from "../../scripts/plugins";

const roots: string[] = [];

function scratch(): { root: string; ctx: PluginContext; env: NodeJS.ProcessEnv } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-plugin-op-"));
  roots.push(root);
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    PATH: process.env.PATH,
    DEVHUB_CONFIG_DIR: path.join(root, "config"),
    DEVHUB_PLUGIN_HOME: path.join(root, "managed"),
    DEVHUB_PLUGIN_TARGET_HOME: path.join(root, "target"),
  };
  return { root, env, ctx: pluginContext({ home: root, env, repoRoot: path.join(root, "repo") }) };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});


function urlMessage(raw: string): string {
  const result = parseGitHubRepoUrl(raw);
  if (result.ok) throw new Error(`expected ${raw} to be rejected`);
  return result.message;
}

async function writeLegacyTemplate(dest: string, options: Parameters<typeof writePluginTemplate>[1]): Promise<void> {
  await writePluginTemplate(dest, options);
  const file = path.join(dest, "devhub-plugin.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  delete manifest.runtime;
  fs.writeFileSync(file, JSON.stringify(manifest));
}

describe("atomic runtime replacement", () => {
  function consent(view: Awaited<ReturnType<typeof prepareLocal>>) {
    if (!view.preview) throw new Error("Missing preview");
    return { accepted: true, revision: view.preview.revision, planDigest: view.preview.planDigest, selectedTargets: [] };
  }
  async function fixture(legacy = false, unnamed = false) {
    const f = scratch();
    const source = path.join(f.root, "source");
    fs.cpSync(path.resolve("../../templates/runtime-plugin"), source, { recursive: true });
    if (legacy) {
      await registerPlugin(source, f.ctx.home, f.env);
      if (unnamed) {
        const registry = JSON.parse(fs.readFileSync(f.ctx.paths.registryPath, "utf8"));
        delete registry.plugins[0].name;
        fs.writeFileSync(f.ctx.paths.registryPath, JSON.stringify(registry));
      }
    } else {
      const initial = await prepareLocal(f.ctx, source);
      await confirmOperation(f.ctx, initial.id, consent(initial));
    }
    const previous = listRegistrations(f.ctx).plugins[0];
    const registry = JSON.parse(fs.readFileSync(f.ctx.paths.registryPath, "utf8"));
    const previousPath = registry.plugins[0].path;
    registry.plugins[0].customSetting = "keep";
    registry.plugins.push({ name: "unrelated", path: path.join(f.root, "unrelated"), enabled: false });
    fs.writeFileSync(f.ctx.paths.registryPath, JSON.stringify(registry));
    const candidate = path.join(f.root, "candidate");
    fs.cpSync(source, candidate, { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(candidate, "devhub-plugin.json"), "utf8"));
    manifest.version = "2.0.0";
    fs.writeFileSync(path.join(candidate, "devhub-plugin.json"), JSON.stringify(manifest));
    if (legacy) {
      const file = path.join(source, "devhub-plugin.json");
      const legacyManifest = JSON.parse(fs.readFileSync(file, "utf8"));
      delete legacyManifest.runtime;
      fs.writeFileSync(file, JSON.stringify(legacyManifest));
    }
    const data = path.join(f.ctx.paths.pluginHome, "runtime-data", previous.id, "state.json");
    fs.mkdirSync(path.dirname(data), { recursive: true });
    fs.writeFileSync(data, '{"keep":"latest data"}\n');
    const review = await prepareLocal(f.ctx, candidate, { reviewRuntimeReplacement: true });
    return { ...f, source, candidate, previous, previousPath, review, data, registry };
  }

  it.each([false, true])("adopts legacy registration (unnamed=%s) without moving its source or data", async (unnamed) => {
    const f = await fixture(true, unnamed);
    const sourceBytes = fs.readFileSync(path.join(f.source, "devhub-plugin.json"), "utf8");
    expect((await confirmOperation(f.ctx, f.review.id, consent(f.review))).state).toBe("succeeded");
    const registry = JSON.parse(fs.readFileSync(f.ctx.paths.registryPath, "utf8"));
    expect(registry.plugins[0]).toMatchObject({ id: f.previous.id, name: "sample-tools", enabled: true, managed: true, customSetting: "keep" });
    expect(registry.plugins[1]).toEqual(f.registry.plugins[1]);
    expect(fs.readFileSync(path.join(f.source, "devhub-plugin.json"), "utf8")).toBe(sourceBytes);
    expect(fs.readFileSync(f.data, "utf8")).toBe('{"keep":"latest data"}\n');
    expect(loadRuntime(f.ctx, "sample-tools").id).toBe(f.previous.id);
    expect(await invokeRuntime(f.ctx, "sample-tools", { kind: "api", method: "GET", path: "/status" })).toEqual({ message: "The plugin API is working." });
  });

  it.each(["registry", "baseline", "candidate"])("rejects stale %s consent before publishing a replacement", async (changed) => {
    const f = await fixture();
    if (changed === "registry") await registryWrite.patchPluginEntry(f.previous.id, { enabled: false }, f.ctx.home, f.env);
    else if (changed === "candidate") fs.appendFileSync(path.join(readStored(f.ctx, f.review.id).internal.workTree!, "worker.mjs"), "\n// changed after consent");
    if (changed === "baseline") {
      const file = path.join(f.previousPath, "devhub-plugin.json");
      const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
      manifest.version = "unreviewed";
      fs.writeFileSync(file, JSON.stringify(manifest));
    }
    const registryBytes = fs.readFileSync(f.ctx.paths.registryPath, "utf8");
    await expect(confirmOperation(f.ctx, f.review.id, consent(f.review))).rejects.toMatchObject({ code: "PREVIEW_STALE" });
    expect(fs.readFileSync(f.ctx.paths.registryPath, "utf8")).toBe(registryBytes);
    expect(fs.existsSync(path.join(f.ctx.paths.pluginHome, "repos", f.review.id))).toBe(false);
    expect(fs.readFileSync(f.data, "utf8")).toBe('{"keep":"latest data"}\n');
  });

  it("keeps the old runtime available before the swap and retries interrupted confirmation once", async () => {
    const f = await fixture();
    const previousBytes = fs.readFileSync(path.join(f.previousPath, "worker.mjs"), "utf8");
    const swap = vi.spyOn(registryWrite, "replaceManagedPlugin").mockImplementationOnce(async () => {
      expect(loadRuntime(f.ctx, "sample-tools").root).toBe(f.previousPath);
      throw new Error("interrupted before registry rename");
    });
    const body = consent(f.review);
    expect((await confirmOperation(f.ctx, f.review.id, body, "replacement-retry")).error?.code).toBe("INTERRUPTED_REPLACEMENT");
    const interrupted = readStored(f.ctx, f.review.id);
    interrupted.view.state = "applying";
    interrupted.internal.pid = 2147483647;
    save(f.ctx, interrupted);
    const recordBytes = fs.readFileSync(path.join(f.ctx.paths.pluginHome, "operations", `${f.review.id}.json`), "utf8");
    expect(getOperation(f.ctx, f.review.id).state).toBe("needs_attention");
    expect(fs.readFileSync(path.join(f.ctx.paths.pluginHome, "operations", `${f.review.id}.json`), "utf8")).toBe(recordBytes);
    fs.rmSync(path.join(interrupted.internal.replacementJournal!.destination, "worker.mjs"));
    expect((await confirmOperation(f.ctx, f.review.id, body, "replacement-retry")).state).toBe("succeeded");
    const registryBytes = fs.readFileSync(f.ctx.paths.registryPath, "utf8");
    expect((await confirmOperation(f.ctx, f.review.id, body, "replacement-retry")).state).toBe("succeeded");
    expect(swap).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync(f.ctx.paths.registryPath, "utf8")).toBe(registryBytes);
    expect(fs.readFileSync(path.join(f.previousPath, "worker.mjs"), "utf8")).toBe(previousBytes);
    expect(fs.readFileSync(f.data, "utf8")).toBe('{"keep":"latest data"}\n');
  });

  it("recognises a committed swap after interruption without repeating writes", async () => {
    const f = await fixture();
    const swap = registryWrite.replaceManagedPlugin;
    const replace = vi.spyOn(registryWrite, "replaceManagedPlugin").mockImplementationOnce(async (...args) => {
      await swap(...args);
      throw new Error("interrupted after registry rename");
    });
    const body = consent(f.review);
    expect((await confirmOperation(f.ctx, f.review.id, body)).state).toBe("succeeded");
    const interrupted = readStored(f.ctx, f.review.id);
    interrupted.view.state = "applying";
    interrupted.internal.pid = 2147483647;
    save(f.ctx, interrupted);
    const registryBytes = fs.readFileSync(f.ctx.paths.registryPath, "utf8");
    expect(getOperation(f.ctx, f.review.id).state).toBe("succeeded");
    expect((await confirmOperation(f.ctx, f.review.id, body)).state).toBe("succeeded");
    expect(replace).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(f.ctx.paths.registryPath, "utf8")).toBe(registryBytes);
    expect(loadRuntime(f.ctx, "sample-tools").root).not.toBe(f.previousPath);
    expect(fs.readFileSync(f.data, "utf8")).toBe('{"keep":"latest data"}\n');
  });
});

describe("parseGitHubRepoUrl", () => {
  it("accepts an https repository and rejects everything else", () => {
    expect(parseGitHubRepoUrl("https://github.com/acme/team-tools").ok).toBe(true);
    expect(parseGitHubRepoUrl("https://github.com/acme/team-tools.git").ok).toBe(true);
    expect(parseGitHubRepoUrl("  ").ok && false).toBe(false);
    expect(urlMessage("")).toMatch(/Paste a GitHub/);
    expect(urlMessage("git@github.com:acme/team-tools.git")).toMatch(/HTTPS/);
    expect(urlMessage("https://github.com/acme/team-tools/tree/main")).toMatch(/\/tree/);
    expect(urlMessage("https://user:token@github.com/acme/team-tools")).toMatch(/token/);
    expect(urlMessage("https://github.com/acme/team-tools?x=1")).toMatch(/query/);
  });
});

describe("plugin paths", () => {
  it("keeps an explicit config dir away from a legacy registry", () => {
    const { root } = scratch();
    const legacy = path.join(root, ".config", "devhub", "plugins.json");
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, JSON.stringify({ plugins: [{ name: "acme", path: "/tmp/acme" }] }));
    const resolved = resolvePluginPaths({
      home: root,
      env: { NODE_ENV: "test", DEVHUB_CONFIG_DIR: path.join(root, "config") },
    });
    expect(resolved.registryPath).toBe(path.join(root, "config", "plugins.json"));
    expect(fs.existsSync(resolved.registryPath)).toBe(false);
  });

  it("ignores process env when a test home is injected without env", () => {
    const previous = process.env.DEVHUB_CONFIG_DIR;
    process.env.DEVHUB_CONFIG_DIR = path.join(os.tmpdir(), "not-the-test-home");
    try {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-plugin-home-"));
      roots.push(home);
      expect(resolvePluginPaths({ home }).registryPath).toBe(path.join(home, ".config", "devhub", "plugins.json"));
    } finally {
      if (previous === undefined) delete process.env.DEVHUB_CONFIG_DIR;
      else process.env.DEVHUB_CONFIG_DIR = previous;
    }
  });
});

describe("local asset install", () => {
  it("previews, installs, disables, re-enables and keeps an edited copy on remove", async () => {
    const { root, ctx } = scratch();
    const source = path.join(root, "source");
    await writeLegacyTemplate(source, { name: "team-tools" });
    fs.writeFileSync(path.join(source, "skills", "team-tools-example", "run.sh"), "#!/bin/sh\necho ran\n");
    fs.chmodSync(path.join(source, "skills", "team-tools-example", "run.sh"), 0o755);
    const marker = path.join(root, "ran");
    fs.writeFileSync(path.join(source, "skills", "team-tools-example", "run.sh"), `#!/bin/sh\ntouch ${marker}\n`);

    const preview = await prepareLocal(ctx, source);
    expect(preview.state).toBe("ready");
    expect(preview.preview?.canApply).toBe(true);
    expect(preview.preview?.contributions.skills.map((skill) => skill.name)).toEqual(["team-tools-example"]);
    expect(listRegistrations(ctx).plugins).toEqual([]);

    const selected = preview.preview?.targets.filter((target) => target.selectedByDefault).map((target) => target.id) ?? [];
    const installed = await confirmOperation(ctx, preview.id, {
      revision: preview.preview!.revision,
      planDigest: preview.preview!.planDigest,
      selectedTargets: selected,
      accepted: true,
    });
    expect(installed.state).toBe("succeeded");
    expect(installed.message).toBe("team-tools is enabled");
    const skillDir = path.join(ctx.paths.targetHome, ".claude", "skills", "team-tools-example");
    expect(fs.existsSync(path.join(skillDir, "SKILL.md"))).toBe(true);
    const agentFile = path.join(ctx.paths.targetHome, ".claude", "agents", "team-tools-reviewer.md");
    const rawAgent = fs.readFileSync(path.join(source, "agents", "team-tools-reviewer.md"), "utf8");
    expect(fs.readFileSync(agentFile, "utf8")).toBe(formatAgentForTool(rawAgent, "claude"));
    expect(fs.existsSync(marker)).toBe(false);
    expect(listRegistrations(ctx).plugins.map((plugin) => plugin.name)).toEqual(["team-tools"]);

    const disableOp = await startLifecycle(ctx, "team-tools", "disable");
    const disabled = await confirmOperation(ctx, disableOp.id, {
      revision: disableOp.preview!.revision,
      planDigest: disableOp.preview!.planDigest,
      selectedTargets: [],
      accepted: true,
    });
    expect(disabled.state).toBe("succeeded");
    expect(fs.existsSync(skillDir)).toBe(false);

    const enable = await startLifecycle(ctx, "team-tools", "enable");
    expect(enable.preview?.canApply).toBe(true);
    const again = await confirmOperation(ctx, enable.id, {
      revision: enable.preview!.revision,
      planDigest: enable.preview!.planDigest,
      selectedTargets: selected,
      accepted: true,
    });
    expect(again.state).toBe("succeeded");
    const skillFile = path.join(skillDir, "SKILL.md");
    fs.appendFileSync(skillFile, "\nlocal edit\n");
    const removal = await startLifecycle(ctx, "team-tools", "remove");
    const removed = await confirmOperation(ctx, removal.id, {
      revision: removal.preview!.revision,
      planDigest: removal.preview!.planDigest,
      selectedTargets: [],
      accepted: true,
    });
    expect(removed.state).toBe("succeeded");
    expect(fs.readFileSync(skillFile, "utf8")).toMatch(/local edit/);
    expect(listRegistrations(ctx).plugins).toEqual([]);
    expect(fs.existsSync(path.join(ctx.paths.pluginHome, "repos", preview.id))).toBe(true);
  });

  it("blocks branding and a missing manifest without registering anything", async () => {
    const { root, ctx } = scratch();
    const branded = path.join(root, "branded");
    await writeLegacyTemplate(branded, { name: "acme-tools" });
    const file = path.join(branded, "devhub-plugin.json");
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    delete manifest.runtime;
    manifest.branding = { themeCss: "branding/theme.css" };
    fs.writeFileSync(file, JSON.stringify(manifest));
    expect(readManifest(branded).ok).toBe(true);
    const blocked = await prepareLocal(ctx, branded);
    expect(blocked.preview?.heading).toBe("This plugin needs features this installer can’t apply");
    expect(blocked.preview?.canApply).toBe(false);

    const empty = path.join(root, "empty");
    fs.mkdirSync(empty);
    const missing = await prepareLocal(ctx, empty);
    expect(missing.state).toBe("invalid");
    expect(missing.message).toMatch(/doesn’t contain a DevHub plugin/);
    expect(listRegistrations(ctx).plugins).toEqual([]);
  });

  it("refuses a second plugin with the same name", async () => {
    const { root, ctx } = scratch();
    const first = path.join(root, "first");
    const second = path.join(root, "second");
    await writeLegacyTemplate(first, { name: "team-tools" });
    await writeLegacyTemplate(second, { name: "team-tools" });
    await registerPlugin(first, root, ctx.env);
    const preview = await prepareLocal(ctx, second);
    expect(preview.preview?.canApply).toBe(false);
    expect(preview.preview?.heading).toMatch(/already registered/);
  });
});

describe("review safety", () => {
  async function ready(ctx: PluginContext, source: string) {
    const preview = await prepareLocal(ctx, source);
    expect(preview.state).toBe("ready");
    const body = {
      revision: preview.preview!.revision,
      planDigest: preview.preview!.planDigest,
      selectedTargets: preview.preview?.targets.filter((target) => target.selectedByDefault).map((target) => target.id) ?? [],
      accepted: true as const,
    };
    return { preview, body };
  }

  it("refuses a stale preview and leaves the registry untouched", async () => {
    const { root, ctx } = scratch();
    const source = path.join(root, "source");
    await writeLegacyTemplate(source, { name: "team-tools" });
    const { preview, body } = await ready(ctx, source);
    await expect(confirmOperation(ctx, preview.id, { ...body, planDigest: "not-the-reviewed-plan" })).rejects.toMatchObject({
      code: "PREVIEW_STALE",
    });
    expect(listRegistrations(ctx).plugins).toEqual([]);
    expect(fs.existsSync(ctx.paths.registryPath)).toBe(false);
  });

  it("keeps an existing registration unchanged until a different plugin is confirmed", async () => {
    const { root, ctx, env } = scratch();
    const local = path.join(root, "local");
    const incoming = path.join(root, "incoming");
    await writeLegacyTemplate(local, { name: "local-tools" });
    await writeLegacyTemplate(incoming, { name: "team-tools" });
    await registerPlugin(local, root, env);
    const file = ctx.paths.registryPath;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { plugins: Array<Record<string, unknown>> };
    parsed.plugins[0].label = "keep me";
    parsed.plugins[0].path = "~/local-tools";
    fs.writeFileSync(file, JSON.stringify(parsed));
    const before = fs.readFileSync(file);
    const preview = await prepareLocal(ctx, incoming);
    expect(preview.preview?.canApply).toBe(true);
    expect(fs.readFileSync(file).equals(before)).toBe(true);

    await confirmOperation(ctx, preview.id, {
      revision: preview.preview!.revision,
      planDigest: preview.preview!.planDigest,
      selectedTargets: preview.preview?.targets.filter((target) => target.selectedByDefault).map((target) => target.id) ?? [],
      accepted: true,
    });
    const after = JSON.parse(fs.readFileSync(file, "utf8")) as { plugins: Array<Record<string, unknown>> };
    expect(after.plugins[0]).toMatchObject({ name: "local-tools", path: "~/local-tools", label: "keep me" });
    expect(after.plugins.map((plugin) => plugin.name)).toEqual(["local-tools", "team-tools"]);
  });

  it("shows disabled and broken registrations", async () => {
    const { root, ctx, env } = scratch();
    const dir = path.join(root, "local");
    await writeLegacyTemplate(dir, { name: "local-tools" });
    await registerPlugin(dir, root, env);
    await setPluginEnabled("local-tools", false, root, env);
    const file = ctx.paths.registryPath;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { plugins: Array<Record<string, unknown>> };
    parsed.plugins.push({ name: "broken-tools", path: path.join(root, "missing"), enabled: true });
    fs.writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);
    const plugins = listRegistrations(ctx).plugins;
    expect(plugins.map((plugin) => [plugin.name, plugin.state, plugin.attention])).toEqual([
      ["local-tools", "disabled", null],
      ["broken-tools", "needs_attention", "Plugin folder not found"],
    ]);
  });

  it("does not run a required command, and will not enable while it is missing", async () => {
    const { root, ctx } = scratch();
    const source = path.join(root, "source");
    await writeLegacyTemplate(source, { name: "team-tools" });
    const bin = path.join(root, "bin");
    const marker = path.join(root, "ran");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "team-probe"), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    const manifestPath = path.join(source, "devhub-plugin.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.requires = { commands: [{ command: "team-probe", install: "install team-probe from your package manager" }] };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    ctx.env = { ...ctx.env, PATH: bin };
    const found = await prepareLocal(ctx, source);
    expect(found.preview?.requirements).toEqual([
      expect.objectContaining({ command: "team-probe", available: true, installHint: "install team-probe from your package manager" }),
    ]);
    expect(fs.existsSync(marker)).toBe(false);

    manifest.requires = { commands: [{ command: "team-probe-missing", install: "Ask your admin to install team-probe-missing." }] };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const missing = await prepareLocal(ctx, source);
    expect(missing.preview?.canApply).toBe(false);
    expect(missing.preview?.requirementsMet).toBe(false);
    expect(listRegistrations(ctx).plugins).toEqual([]);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("blocks an undeclared MCP package and a dashboard root outside the plugin", async () => {
    const { root, ctx } = scratch();
    const mcp = path.join(root, "mcp");
    await writeLegacyTemplate(mcp, { name: "team-tools" });
    const pkg = path.join(mcp, "mcp-servers", "demo");
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "demo", scripts: { postinstall: "echo ran" } }));
    const blocked = await prepareLocal(ctx, mcp);
    expect(blocked.preview?.canApply).toBe(false);
    expect(blocked.preview?.unsupported).toContain("MCP servers");
    expect(fs.existsSync(path.join(mcp, "node_modules"))).toBe(false);
    expect(listRegistrations(ctx).plugins).toEqual([]);

    const escaped = path.join(root, "escaped");
    await writeLegacyTemplate(escaped, { name: "other-tools" });
    const manifestPath = path.join(escaped, "devhub-plugin.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.dashboard = { root: "../outside", paths: ["app/page.tsx"] };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const invalid = await prepareLocal(ctx, escaped);
    expect(invalid.state).toBe("invalid");
    expect(invalid.message).toBe("This repository isn’t a valid DevHub plugin");
  });

  it("skips git-ignored build output in a local repo but still rejects visible symlinks", async () => {
    const { root, ctx } = scratch();
    const source = path.join(root, "source");
    await writeLegacyTemplate(source, { name: "team-tools" });
    const git = (...args: string[]) => expect(spawnSync("git", ["-C", source, ...args]).status).toBe(0);
    git("init", "-q");
    fs.writeFileSync(path.join(source, ".gitignore"), "node_modules/\n");
    fs.mkdirSync(path.join(source, "node_modules", ".bin"), { recursive: true });
    fs.symlinkSync("../vitest/cli.js", path.join(source, "node_modules", ".bin", "vitest"));
    const { preview } = await ready(ctx, source);
    expect(preview.preview?.canApply).toBe(true);

    fs.symlinkSync("devhub-plugin.json", path.join(source, "visible-link"));
    const unsafe = await prepareLocal(ctx, source);
    expect(unsafe.state).toBe("invalid");
    expect(unsafe.message).toBe("This plugin contains an unsafe file path");
  });

  it("keeps the event loop responsive while checking a local plugin's Git files", async () => {
    const { root, ctx } = scratch();
    const source = path.join(root, "source");
    await writeLegacyTemplate(source, { name: "team-tools" });
    expect(spawnSync("git", ["-C", source, "init", "-q"]).status).toBe(0);
    fs.writeFileSync(path.join(source, ".gitignore"), "node_modules/\n");
    fs.mkdirSync(path.join(source, "node_modules"));
    fs.symlinkSync("missing", path.join(source, "node_modules", "ignored-link"));
    const bin = path.join(root, "bin");
    const marker = path.join(root, "timer-ran");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "git"), `#!/bin/sh
case "$*" in
  *rev-parse*) sleep 0.3; test -f "$R6_TEST_MARKER" || exit 1 ;;
esac
PATH="$R6_TEST_ORIGINAL_PATH" exec git "$@"
`, { mode: 0o755 });
    ctx.env = { ...ctx.env, PATH: bin + path.delimiter + (process.env.PATH ?? ""), R6_TEST_ORIGINAL_PATH: process.env.PATH, R6_TEST_MARKER: marker };
    const timer = setTimeout(() => fs.writeFileSync(marker, "ready"), 25);
    try {
      expect((await prepareLocal(ctx, source)).preview?.canApply).toBe(true);
    } finally {
      clearTimeout(timer);
    }
  });

  it("rejects a changed target parent before copying and keeps unrelated files", async () => {
    const { root, ctx } = scratch();
    const source = path.join(root, "source");
    await writeLegacyTemplate(source, { name: "team-tools" });
    const { preview, body } = await ready(ctx, source);
    const kept = path.join(ctx.paths.targetHome, ".claude", "skills", "kept-skill");
    fs.mkdirSync(kept, { recursive: true });
    fs.writeFileSync(path.join(kept, "SKILL.md"), "keep me");
    fs.mkdirSync(ctx.paths.targetHome, { recursive: true });
    fs.writeFileSync(path.join(ctx.paths.targetHome, ".codex"), "not a directory");
    await expect(confirmOperation(ctx, preview.id, body)).rejects.toMatchObject({ code: "PREVIEW_STALE" });
    expect(fs.existsSync(path.join(ctx.paths.targetHome, ".claude", "skills", "team-tools-example"))).toBe(false);
    expect(fs.readFileSync(path.join(kept, "SKILL.md"), "utf8")).toBe("keep me");
    expect(listRegistrations(ctx).plugins).toEqual([]);
  });

  it("removes only unchanged files it owns when cleaning up", () => {
    const { root } = scratch();
    const edited = path.join(root, "edited.md");
    const plain = path.join(root, "plain.md");
    fs.writeFileSync(edited, "original");
    fs.writeFileSync(plain, "same");
    const editedHash = hashFile(edited);
    const plainHash = hashFile(plain);
    fs.writeFileSync(edited, "local edit");
    const result = cleanupReceipt({
      pluginId: "p",
      sha: null,
      planDigest: "digest",
      files: [
        { kind: "agent", name: "edited", tool: "claude", destination: edited, hash: editedHash },
        { kind: "agent", name: "plain", tool: "claude", destination: plain, hash: plainHash },
      ],
    }, root);
    expect(fs.readFileSync(edited, "utf8")).toBe("local edit");
    expect(fs.existsSync(plain)).toBe(false);
    expect(result.kept).toEqual([edited]);
    expect(result.removed).toEqual([plain]);
  });

  it("surfaces a crashed review and an unfinished apply", async () => {
    const { ctx } = scratch();
    const dead = 1 << 30;
    const review = blank(ctx, "install", prepareSteps());
    review.internal.pid = dead;
    review.view.state = "cloning";
    save(ctx, review);
    expect((await waitForOperation(ctx, review.view.id)).state).toBe("expired");

    const applying = blank(ctx, "install", prepareSteps());
    applying.internal.pid = dead;
    applying.view.state = "applying";
    save(ctx, applying);
    const view = await waitForOperation(ctx, applying.view.id);
    expect(view.state).toBe("needs_attention");
    expect(view.message).toBe("Plugin changes need attention");
  });
});

describe("url prepare", () => {
  it("stops on an access failure and does not clone again for the same request", async () => {
    const { ctx } = scratch();
    let calls = 0;
    const runner: CommandRunner = {
      async run(file) {
        calls += 1;
        if (file === "gh") return { code: 1, stdout: "", stderr: "not logged in to github.com", timedOut: false };
        return { code: 128, stdout: "", stderr: "fatal: Authentication failed for secret-token", timedOut: false };
      },
    };
    ctx.runner = runner;
    const started = await startPrepare(ctx, "https://github.com/acme/widgets", "idempotency-key");
    const again = await startPrepare(ctx, "https://github.com/acme/widgets", "idempotency-key");
    expect(again.id).toBe(started.id);
    await expect(startPrepare(ctx, "https://github.com/acme/other", "idempotency-key")).rejects.toThrow(/different request/);
    const view = await waitForOperation(ctx, started.id);
    expect(view.state).toBe("needs_access");
    expect(view.message).toBe("We couldn’t access this repository");
    expect(JSON.stringify(view)).not.toMatch(/secret-token/);
    expect(listRegistrations(ctx).plugins).toEqual([]);
    const settled = calls;
    expect((await startPrepare(ctx, "https://github.com/acme/widgets", "idempotency-key")).id).toBe(started.id);
    expect(calls).toBe(settled);
    const diagnostic = await diagnosticsFor(ctx, started.id);
    expect(diagnostic).toMatchObject({
      operationId: started.id,
      operation: "install",
      phase: "needs_access",
      errorCode: "NEEDS_ACCESS",
      source: "https://github.com/acme/widgets",
      ref: "default",
      sha: null,
      timedOut: false,
    });
    expect(JSON.stringify(diagnostic)).not.toMatch(/secret-token|ghp_|Authorization/);
  });

  it("cannot enable a review that was cancelled", async () => {
    const { ctx } = scratch();
    ctx.runner = {
      run(_file, _args, opts) {
        return new Promise((resolve) => {
          const finish = () => resolve({ code: 1, stdout: "", stderr: "", timedOut: false, aborted: true });
          if (opts.signal?.aborted) finish();
          else opts.signal?.addEventListener("abort", finish, { once: true });
        });
      },
    };
    const started = await startPrepare(ctx, "https://github.com/acme/widgets");
    await cancelOperation(ctx, started.id);
    await operationSettled(started.id);
    const view = await waitForOperation(ctx, started.id);
    expect(view.state).toBe("cancelled");
    expect(view.message).toBe("Cancelled. No plugin was enabled.");
    await expect(confirmOperation(ctx, started.id, {
      revision: 1,
      planDigest: "stale",
      selectedTargets: [],
      accepted: true,
    })).rejects.toBeInstanceOf(PluginApiError);
    expect(listRegistrations(ctx).plugins).toEqual([]);
  });
});

describe("template and cli", () => {
  const io = { stdout: () => undefined, stderr: () => undefined };

  it("renders a valid scaffold and a dry run writes nothing", async () => {
    const { root, env } = scratch();
    let out = "";
    const capture = { stdout: (chunk: string) => { out += chunk; }, stderr: () => undefined };
    expect(await runPluginsCli(["new", "team-tools", "--out", path.join(root, "missing"), "--dry-run"], capture, env)).toBe(0);
    expect(fs.existsSync(path.join(root, "missing"))).toBe(false);
    expect(out).toMatch(/devhub-plugin.json/);
    expect(fs.existsSync(path.join(root, "config", "plugins.json"))).toBe(false);
    const dest = path.join(root, "created");
    expect(await runPluginsCli(["new", "acme-tools", "--out", dest], io, env)).toBe(0);
    const manifest = readManifest(dest);
    expect(manifest.ok).toBe(true);
    if (!manifest.ok || !manifest.manifest.runtime) throw new Error("Missing scaffold runtime");
    expect(() => verifyRuntimeFiles(dest, manifest.manifest.runtime!)).not.toThrow();
    const page = await execExternal(process.execPath, [path.join(dest, "worker.mjs")], { input: JSON.stringify({ kind: "page", path: "/" }) });
    expect(JSON.parse(page.stdout)).toContain("Acme tools");
    expect(await runPluginsCli(["new", "other-tools", "--out", path.join(root, "invalid"), "--branding"], io, env)).toBe(1);
    const files = renderPluginTemplate({ name: "team-tools" }).map((file) => file.path);
    expect(files).toEqual([
      "devhub-plugin.json",
      "worker.mjs",
      "package-lock.json",
      "README.md",
      ".gitignore",
      ".gitattributes",
      "skills/team-tools-example/SKILL.md",
      "agents/team-tools-reviewer.md",
      "examples/mcp/server.ts.example",
      "examples/mcp/package.json.example",
      "examples/mcp/catalog.json.example",
    ]);
    expect(files.some((file) => file.startsWith("mcp-servers/"))).toBe(false);
  });

  it("refuses an existing destination and keeps paths relative to INIT_CWD", async () => {
    const { root, env } = scratch();
    const existing = path.join(root, "existing");
    fs.mkdirSync(existing);
    let err = "";
    expect(await runPluginsCli(["new", "team-tools", "--out", existing], { stdout: () => undefined, stderr: (chunk) => { err += chunk; } }, env)).toBe(1);
    expect(err).toMatch(/Refusing to overwrite/);
    expect(fs.readdirSync(existing)).toEqual([]);

    const caller = path.join(root, "caller");
    fs.mkdirSync(caller);
    expect(await runPluginsCli(["new", "team-tools", "--out", "out"], io, { ...env, INIT_CWD: caller })).toBe(0);
    expect(fs.existsSync(path.join(caller, "out", "devhub-plugin.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "out"))).toBe(false);
    expect(fs.existsSync(path.join(root, "config", "plugins.json"))).toBe(false);
  });

  it("lists disabled and broken plugins in sanitised JSON", async () => {
    const { root, env } = scratch();
    const dest = path.join(root, "created");
    expect(await runPluginsCli(["new", "team-tools", "--out", dest], io, env)).toBe(0);
    expect(await runPluginsCli(["add", dest], io, env)).toBe(0);
    let disabledOutput = "";
    const captureDisabled = { stdout: (chunk: string) => { disabledOutput += chunk; }, stderr: () => undefined };
    expect(await runPluginsCli(["disable", "team-tools"], captureDisabled, env)).toBe(0);
    expect(disabledOutput).toContain(fs.realpathSync(dest));
    const file = path.join(root, "config", "plugins.json");
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { plugins: Array<Record<string, unknown>> };
    parsed.plugins.push({ name: "broken-tools", path: path.join(root, "missing"), enabled: true, token: "ghp_should_not_matter" });
    fs.writeFileSync(file, `${JSON.stringify(parsed)}\n`);

    let listed = "";
    expect(await runPluginsCli(["list", "--json"], { stdout: (chunk) => { listed += chunk; }, stderr: () => undefined }, env)).toBe(0);
    expect(JSON.parse(listed)).toEqual([]);

    let all = "";
    expect(await runPluginsCli(["list", "--all", "--json"], { stdout: (chunk) => { all += chunk; }, stderr: () => undefined }, env)).toBe(0);
    const rows = JSON.parse(all) as Array<Record<string, unknown>>;
    expect(rows.map((row) => [row.name, row.state])).toEqual([
      ["team-tools", "disabled"],
      ["broken-tools", "needs_attention"],
    ]);
    expect(all).not.toContain(root);
    expect(all).not.toContain("ghp_");
    expect(rows.every((row) => row.path === "<path>" || String(row.path).startsWith("<home>"))).toBe(true);
  });
});

function managementRequest(method: string, headers: Record<string, string>): Request {
  return new Request("http://127.0.0.1:1345/api/plugins/operations/op/diagnostics", { method, headers });
}

describe("management auth", () => {
  const keys = ["DEVHUB_BOOTSTRAP_TOKEN", "DEVHUB_API_SECRET", "DEVHUB_LAN_PROXY_HOST", "DEVHUB_BIND_HOST"] as const;

  function withEnv(extra: Record<string, string | undefined>, run: () => void) {
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, extra);
    try {
      run();
    } finally {
      for (const key of keys) {
        const value = previous[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  it("rejects details and diagnostics with no secret, cookie or desktop session", () => {
    withEnv({ DEVHUB_BOOTSTRAP_TOKEN: "desktop-session-token", DEVHUB_BIND_HOST: "127.0.0.1" }, () => {
      const read = managementRequest("GET", { host: "127.0.0.1:1345", referer: "http://127.0.0.1:1345/plugins" });
      const change = managementRequest("POST", { host: "127.0.0.1:1345", origin: "http://127.0.0.1:1345" });
      expect(decideManagement(read)).toEqual({ ok: false, status: 403 });
      expect(decideManagement(change)).toEqual({ ok: false, status: 403 });
    });
  });

  it("rejects a cross-origin change even with the desktop cookie", () => {
    withEnv({ DEVHUB_BOOTSTRAP_TOKEN: "desktop-session-token" }, () => {
      const req = managementRequest("POST", {
        host: "127.0.0.1:1345",
        origin: "http://evil.example",
        cookie: `${DESKTOP_COOKIE}=desktop-session-token`,
      });
      expect(decideManagement(req)).toEqual({ ok: false, status: 403 });
    });
  });

  it("rejects loopback browser access when the LAN is forwarded", () => {
    withEnv({ DEVHUB_LAN_PROXY_HOST: "auto", DEVHUB_BIND_HOST: "127.0.0.1" }, () => {
      const change = managementRequest("POST", { host: "127.0.0.1:1345", origin: "http://127.0.0.1:1345" });
      const read = managementRequest("GET", { host: "127.0.0.1:1345", referer: "http://127.0.0.1:1345/plugins" });
      expect(decideManagement(change)).toEqual({ ok: false, status: 403 });
      expect(decideManagement(read)).toEqual({ ok: false, status: 403 });
    });
  });

  it("accepts the local secret and a same-origin desktop session", () => {
    withEnv({ DEVHUB_API_SECRET: "local-api-secret", DEVHUB_BOOTSTRAP_TOKEN: "desktop-session-token" }, () => {
      expect(decideManagement(managementRequest("POST", { "x-devhub-secret": "local-api-secret" }))).toEqual({ ok: true });
      expect(decideManagement(managementRequest("GET", { "x-devhub-secret": "local-api-secret" }))).toEqual({ ok: true });
      expect(decideManagement(managementRequest("POST", {
        host: "127.0.0.1:1345",
        origin: "http://127.0.0.1:1345",
        cookie: `${DESKTOP_COOKIE}=desktop-session-token`,
      }))).toEqual({ ok: true });
    });
  });

  it("accepts a loopback browser session only when nothing is forwarding the LAN", () => {
    withEnv({ DEVHUB_BIND_HOST: "127.0.0.1" }, () => {
      expect(decideManagement(managementRequest("POST", { host: "127.0.0.1:1345", origin: "http://127.0.0.1:1345" }))).toEqual({ ok: true });
      expect(decideManagement(managementRequest("GET", { host: "127.0.0.1:1345", referer: "http://127.0.0.1:1345/plugins" }))).toEqual({ ok: true });
      expect(decideManagement(managementRequest("POST", { host: "127.0.0.1:1345", referer: "http://127.0.0.1:1345/plugins" }))).toEqual({ ok: false, status: 403 });
    });
  });
});
