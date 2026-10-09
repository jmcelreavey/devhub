import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { formatAgentForTool } from "@/lib/agent/sync-format";
import { DESKTOP_COOKIE } from "@/lib/desktop/bootstrap-auth";
import { PluginApiError } from "./context";
import { hashFile } from "./inspect";
import { cleanupReceipt } from "./install";
import { decideManagement } from "./management-auth";
import { readManifest } from "./manifest";
import {
  cancelOperation,
  confirmOperation,
  diagnosticsFor,
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
import { parseGitHubRepoUrl, type CommandRunner } from "./source";
import { blank, prepareSteps, save } from "./store";
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
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});


function urlMessage(raw: string): string {
  const result = parseGitHubRepoUrl(raw);
  if (result.ok) throw new Error(`expected ${raw} to be rejected`);
  return result.message;
}

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
    writePluginTemplate(source, { name: "team-tools" });
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
    writePluginTemplate(branded, { name: "acme-tools", branding: true, brandName: "Acme" });
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
    writePluginTemplate(first, { name: "team-tools" });
    writePluginTemplate(second, { name: "team-tools" });
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
    writePluginTemplate(source, { name: "team-tools" });
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
    writePluginTemplate(local, { name: "local-tools" });
    writePluginTemplate(incoming, { name: "team-tools" });
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
    writePluginTemplate(dir, { name: "local-tools" });
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
    writePluginTemplate(source, { name: "team-tools" });
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
    writePluginTemplate(mcp, { name: "team-tools" });
    const pkg = path.join(mcp, "mcp-servers", "demo");
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "demo", scripts: { postinstall: "echo ran" } }));
    const blocked = await prepareLocal(ctx, mcp);
    expect(blocked.preview?.canApply).toBe(false);
    expect(blocked.preview?.unsupported).toContain("MCP servers");
    expect(fs.existsSync(path.join(mcp, "node_modules"))).toBe(false);
    expect(listRegistrations(ctx).plugins).toEqual([]);

    const escaped = path.join(root, "escaped");
    writePluginTemplate(escaped, { name: "other-tools" });
    const manifestPath = path.join(escaped, "devhub-plugin.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.dashboard = { root: "../outside", paths: ["app/page.tsx"] };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const invalid = await prepareLocal(ctx, escaped);
    expect(invalid.state).toBe("invalid");
    expect(invalid.message).toBe("This plugin contains an unsafe file path");
  });

  it("rejects a changed target parent before copying and keeps unrelated files", async () => {
    const { root, ctx } = scratch();
    const source = path.join(root, "source");
    writePluginTemplate(source, { name: "team-tools" });
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
    const diagnostic = diagnosticsFor(ctx, started.id);
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
    expect(await runPluginsCli(["new", "acme-tools", "--out", dest, "--branding", "--brand-name", "Acme", "--primary", "#2454a6", "--accent", "#85adff"], io, env)).toBe(0);
    expect(readManifest(dest).ok).toBe(true);
    const files = renderPluginTemplate({ name: "team-tools" }).map((file) => file.path);
    expect(files).toEqual([
      "devhub-plugin.json",
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
    expect(await runPluginsCli(["disable", "team-tools"], io, env)).toBe(0);
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

function managementRequest(method: string, headers: Record<string, string>): NextRequest {
  return new NextRequest("http://127.0.0.1:1345/api/plugins/operations/op/diagnostics", { method, headers });
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
