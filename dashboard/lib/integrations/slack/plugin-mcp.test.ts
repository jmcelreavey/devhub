import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writePersonalMcpServer } from "@/lib/mcp/personal";
import { pluginRegistryPath } from "@/lib/plugins/registry";
import { SlackToolCatalog, groupByCategory, toSlackTool, type McpToolSession } from "./mcp-catalog";
import { createPluginAwareSession, discoverPluginMcpSpecs, pluginToolSignature, type PluginMcpSpec } from "./plugin-mcp";
import { normalizePluginNeed, pluginNeedsDir, readPluginNeeds } from "./plugin-needs";
import { formatSlackNeed } from "./needs-you-format";
import { slackToolRisk } from "./tool-risk";

let home: string;
let plugin: string;
const rawTool = (name: string, annotations?: Record<string, boolean>) => ({ name, description: name, inputSchema: { type: "object", properties: {} }, ...(annotations ? { annotations } : {}) });
const spec: PluginMcpSpec = { id: "fake", plugin: "fake-plugin", kind: "stdio", command: "node", args: ["fake.mjs"], env: {} };
function session(tools: unknown[]): McpToolSession {
  return { listTools: vi.fn(async () => tools), callTool: vi.fn(async (name) => ({ text: name, isError: false })), close: vi.fn(async () => {}) };
}
function registry(enabled = true) {
  const file = pluginRegistryPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ plugins: [{ name: "fake-plugin", path: plugin, enabled }] }));
}
function server(name: string, config: Record<string, unknown>) {
  fs.writeFileSync(path.join(plugin, "mcp", `${name}.json`), JSON.stringify(config));
}
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "slack-plugin-"));
  plugin = path.join(home, "fake-plugin");
  fs.mkdirSync(path.join(plugin, "mcp"), { recursive: true });
  fs.writeFileSync(path.join(plugin, "devhub-plugin.json"), JSON.stringify({ name: "fake-plugin", version: "1.0.0", devhubApi: "1", contributes: { mcp: "mcp" } }));
  registry();
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(home, { recursive: true, force: true }); });

describe("plugin tools in the Slack catalog", () => {
  it("scopes metadata and disk caches by profile", async () => {
    const createSession = (profile: string) => session([rawTool(`only_${profile}`, { readOnlyHint: true })]);
    const options = { createSession, cacheFile: path.join(home, "profile-tools.json") };
    const first = new SlackToolCatalog(options);
    expect((await first.tools("work"))[0].name).toBe("only_work");
    expect((await first.tools("personal"))[0].name).toBe("only_personal");
    await first.close();
    const create = vi.fn(createSession);
    const restarted = new SlackToolCatalog({ ...options, createSession: create });
    try {
      expect((await restarted.tools("personal"))[0].name).toBe("only_personal");
      expect((await restarted.tools("work"))[0].name).toBe("only_work");
      expect(create).not.toHaveBeenCalled();
    } finally { await restarted.close(); }
  });

  it("refreshes every live profile's routes on discovery changes and rechecks permissions", async () => {
    let version = "one";
    let specs = [spec];
    const peers: Record<string, McpToolSession> = {};
    const catalog = new SlackToolCatalog({
      cacheFile: path.join(home, "live-tools.json"), signature: () => version,
      createSession: (profile) => createPluginAwareSession(session([rawTool("core_read", { readOnlyHint: true })]), {
        discover: () => specs,
        connect: () => peers[`${profile}-${version}`] = session([rawTool("fake_read", { readOnlyHint: version === "one" })]),
      }),
    });
    try {
      await catalog.tools("work"); await catalog.tools("personal");
      version = "two";
      for (const profile of ["work", "personal"]) {
        await expect(catalog.call(profile, "fake_read", {})).rejects.toThrow(/permissions can be checked/);
        expect(peers[`${profile}-one`].close).toHaveBeenCalledOnce();
        expect(peers[`${profile}-one`].callTool).not.toHaveBeenCalled();
        expect((await catalog.tools(profile)).find((tool) => tool.name === "fake_read")?.readOnly).toBe(false);
        await catalog.call(profile, "fake_read", {});
        expect(peers[`${profile}-two`].callTool).toHaveBeenCalledOnce();
      }
      version = "three"; specs = [];
      await expect(catalog.call("work", "fake_read", {})).rejects.toThrow(/permissions/);
      expect((await catalog.tools("work")).some((tool) => tool.name === "fake_read")).toBe(false);
      expect(peers["work-two"].close).toHaveBeenCalledOnce();
    } finally { await catalog.close(); }
  });
  it("discovers enabled checkout and runtime servers, resolves paths, and invalidates on plugin changes", () => {
    server("fake", { command: "node", args: ["PLUGIN_ROOT/server.mjs", "REPO_ROOT"], env: { MODE: "test" } });
    server("remote", { type: "http", url: "http://127.0.0.1:9999/mcp" });
    server("legacy", { type: "sse", url: "http://127.0.0.1:9999/sse" });
    server("disabled", { command: "node", enabled: false });
    server("oauth", { url: "https://example.test/mcp", oauth: { enabled: true } });
    server("devhub", { command: "never-core" });
    const options = { home, repoRoot: "/checkout", runtime: () => [{ plugin: "runtime-plugin", id: "runtime", url: "http://127.0.0.1:9998/mcp", headers: {} }] };
    const specs = discoverPluginMcpSpecs(options);
    expect(specs.map((entry) => entry.id).sort()).toEqual(["fake", "legacy", "remote", "runtime"]);
    expect(specs.find((entry) => entry.id === "legacy")).toMatchObject({ kind: "sse" });
    expect(specs.find((entry) => entry.id === "fake")).toMatchObject({ kind: "stdio", args: [`${plugin}/server.mjs`, "/checkout"], env: { MODE: "test" } });
    const before = pluginToolSignature(options);
    server("fake", { command: "node", args: ["new.mjs"] });
    expect(pluginToolSignature(options)).not.toBe(before);
    registry(false);
    expect(discoverPluginMcpSpecs({ ...options, runtime: () => [] })).toEqual([]);
    expect(pluginToolSignature({ ...options, runtime: () => [] })).toBe("");
  });

  it("merges fake plugin tools, groups them dynamically and preserves annotations and Slack overrides", async () => {
    const core = session([rawTool("core_read", { readOnlyHint: true })]);
    const fake = session([rawTool("fake_read", { readOnlyHint: true }), rawTool("fake_unknown"), rawTool("fake_delete", { destructiveHint: true }), rawTool("scripts_run", { readOnlyHint: true }), rawTool("fake_conflict", { readOnlyHint: true, destructiveHint: true })]);
    const composite = createPluginAwareSession(core, { discover: () => [spec], connect: () => fake });
    const catalog = new SlackToolCatalog({ createSession: () => composite, cacheFile: path.join(home, "tools.json") });
    try {
      const tools = await catalog.tools("work");
      const group = groupByCategory(tools).get("plugin:fake-plugin")!;
      expect(group).toHaveLength(5);
      expect(group.find((tool) => tool.name === "fake_read")).toMatchObject({ plugin: "fake-plugin", readOnly: true, destructive: false });
      expect(slackToolRisk(group.find((tool) => tool.name === "fake_unknown")!, {})).toEqual({ confirm: true, destructive: false });
      expect(group.find((tool) => tool.name === "fake_unknown")?.unrated).toBe(true);
      expect(slackToolRisk(group.find((tool) => tool.name === "fake_delete")!, {})).toEqual({ confirm: true, destructive: true });
      expect(slackToolRisk(group.find((tool) => tool.name === "scripts_run")!, {})).toEqual({ confirm: true, destructive: true });
      expect(slackToolRisk(group.find((tool) => tool.name === "fake_conflict")!, {})).toEqual({ confirm: true, destructive: true });
      await catalog.call("work", "fake_read", {});
      expect(fake.callTool).toHaveBeenCalledWith("fake_read", {}, undefined);
      expect(core.callTool).not.toHaveBeenCalled();
    } finally { await catalog.close(); }
  });

  it("routes a plugin tool after a disk-cache restart, and never lets a plugin shadow a core tool", async () => {
    const core = session([rawTool("shared")]);
    const fake = session([rawTool("shared"), rawTool("fake_read")]);
    const composite = createPluginAwareSession(core, { discover: () => [spec], connect: () => fake });
    await composite.callTool("fake_read", {});
    await composite.callTool("shared", {});
    expect(fake.callTool).toHaveBeenCalledExactlyOnceWith("fake_read", {}, undefined);
    expect(core.callTool).toHaveBeenCalledExactlyOnceWith("shared", {}, undefined);
    await composite.close();
    expect(fake.close).toHaveBeenCalledOnce();
  });

  it("removes disabled plugin sessions and recovers when listing a plugin fails", async () => {
    let specs = [spec];
    const fake = session([rawTool("fake_read")]);
    const composite = createPluginAwareSession(session([rawTool("core_read")]), { discover: () => specs, connect: () => fake });
    expect(await composite.listTools()).toHaveLength(2);
    specs = [];
    expect(await composite.listTools()).toHaveLength(1);
    expect(fake.close).toHaveBeenCalledOnce();
    const broken = session([]);
    vi.mocked(broken.listTools).mockRejectedValue(new Error("offline"));
    const isolated = createPluginAwareSession(session([rawTool("core_read")]), { discover: () => [spec], connect: () => broken });
    expect(await isolated.listTools()).toHaveLength(1);
    expect(broken.close).toHaveBeenCalledOnce();
    await composite.close(); await isolated.close();
  });

  it("bounds a plugin that hangs during discovery without losing core tools", async () => {
    vi.useFakeTimers();
    try {
      const fake = session([]);
      vi.mocked(fake.listTools).mockImplementation(() => new Promise(() => {}));
      const composite = createPluginAwareSession(session([rawTool("core_read")]), { discover: () => [spec], connect: () => fake, timeoutMs: 100 });
      const listing = composite.listTools();
      await vi.advanceTimersByTimeAsync(101);
      expect(await listing).toHaveLength(1);
      expect(fake.close).toHaveBeenCalledOnce();
      await composite.close();
    } finally { vi.useRealTimers(); }
  });

  it("invalidates memory and disk caches immediately on install/removal, and refreshes live plugins after a short TTL", async () => {
    let signature = "";
    let now = 1000;
    const listTools = vi.fn(async () => signature ? [rawTool("core_read"), rawTool("fake_read")] : [rawTool("core_read")]);
    const core = { ...session([]), listTools };
    const options = { createSession: () => core, cacheFile: path.join(home, "tools.json"), signature: () => signature, now: () => now };
    const catalog = new SlackToolCatalog(options);
    expect(await catalog.tools("work")).toHaveLength(1);
    signature = "installed";
    expect(await catalog.tools("work")).toHaveLength(2);
    now += 60_001;
    expect(await catalog.tools("work")).toHaveLength(2);
    expect(listTools).toHaveBeenCalledTimes(3);
    signature = "";
    expect(await new SlackToolCatalog(options).tools("work")).toHaveLength(1);
    await catalog.close();
  });

  it("also accepts unknown tools added directly to the DevHub server", () => {
    expect(toSlackTool(rawTool("widget_read", { readOnlyHint: true }))).toMatchObject({ category: "widget", readOnly: true });
    expect(toSlackTool(rawTool("widget_unknown"))).toMatchObject({ category: "widget", readOnly: false, unrated: true });
  });
});

describe("external MCP discovery and tool collisions", () => {
  it("discovers shared and personal servers with disabled/OAuth gates and signature invalidation", () => {
    const repoRoot = path.join(home, "repo");
    const shared = path.join(repoRoot, "mcp", "shared");
    fs.mkdirSync(shared, { recursive: true });
    fs.writeFileSync(path.join(shared, "remote.json"), JSON.stringify({ url: "https://remote.test/mcp", headers: { Authorization: "test-token" } }));
    fs.writeFileSync(path.join(shared, "disabled.json"), JSON.stringify({ command: "node", enabled: false }));
    fs.writeFileSync(path.join(shared, "oauth.json"), JSON.stringify({ url: "https://oauth.test/mcp", oauth: { enabled: true } }));
    const options = { home, repoRoot, runtime: () => [] };
    const before = pluginToolSignature(options);
    expect(discoverPluginMcpSpecs(options)).toEqual([expect.objectContaining({ id: "remote", kind: "http" })]);
    writePersonalMcpServer(home, "personal", { command: "node", args: ["personal.mjs"] });
    expect(discoverPluginMcpSpecs(options).find((entry) => entry.id === "personal")).toMatchObject({ kind: "stdio", args: ["personal.mjs"] });
    fs.writeFileSync(path.join(shared, "second.json"), JSON.stringify({ command: "node", args: ["REPO_ROOT/tool.mjs"] }));
    expect(pluginToolSignature(options)).not.toBe(before);
    expect(discoverPluginMcpSpecs(options).find((entry) => entry.id === "second")).toMatchObject({ args: [repoRoot + "/tool.mjs"] });
  });

  it("keeps servers with the same name from two enabled plugins", () => {
    const other = path.join(home, "second-plugin");
    fs.mkdirSync(path.join(other, "mcp"), { recursive: true });
    fs.writeFileSync(path.join(other, "devhub-plugin.json"), JSON.stringify({ name: "second-plugin", version: "1.0.0", devhubApi: "1", contributes: { mcp: "mcp" } }));
    fs.writeFileSync(pluginRegistryPath(home), JSON.stringify({ plugins: [{ name: "fake-plugin", path: plugin, enabled: true }, { name: "second-plugin", path: other, enabled: true }] }));
    server("same", { command: "node", args: ["first.mjs"] });
    fs.writeFileSync(path.join(other, "mcp", "same.json"), JSON.stringify({ command: "node", args: ["second.mjs"] }));
    const specs = discoverPluginMcpSpecs({ home, repoRoot: null, runtime: () => [] });
    expect(specs).toHaveLength(2);
    expect(new Set(specs.map((spec) => spec.id)).size).toBe(2);
    expect(specs.map((spec) => spec.plugin).sort()).toEqual(["fake-plugin", "second-plugin"]);
  });

  it("keeps all colliding tools, routes aliases to their original names and does not grant core read exceptions", async () => {
    const core = session([rawTool("task_note_add")]);
    const first = session([rawTool("task_note_add"), rawTool("shared")]);
    const second = session([rawTool("shared")]);
    const other: PluginMcpSpec = { ...spec, id: "other", plugin: undefined };
    const composite = createPluginAwareSession(core, { discover: () => [spec, other], connect: (source) => source.id === spec.id ? first : second });
    try {
      const tools = (await composite.listTools()).map(toSlackTool).filter((tool) => tool !== null);
      expect(tools).toHaveLength(4);
      expect(new Set(tools.map((tool) => tool.name)).size).toBe(4);
      for (const tool of tools.filter((tool) => tool.server)) {
        expect(slackToolRisk(tool, {})).toMatchObject({ confirm: true });
        await composite.callTool(tool.name, { action: "test" });
      }
      expect(first.callTool).toHaveBeenCalledWith("task_note_add", { action: "test" }, undefined);
      expect(first.callTool).toHaveBeenCalledWith("shared", { action: "test" }, undefined);
      expect(second.callTool).toHaveBeenCalledWith("shared", { action: "test" }, undefined);
      expect(core.callTool).not.toHaveBeenCalled();
    } finally { await composite.close(); }
  });

  it("starts core and external discovery together", async () => {
    let release!: (tools: unknown[]) => void;
    const core = session([]);
    vi.mocked(core.listTools).mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const plugin = session([rawTool("plugin_read")]);
    const composite = createPluginAwareSession(core, { discover: () => [spec], connect: () => plugin });
    const listing = composite.listTools();
    await Promise.resolve();
    expect(plugin.listTools).toHaveBeenCalledOnce();
    release([rawTool("core_read")]);
    expect(await listing).toHaveLength(2);
    await composite.close();
  });
});

describe("plugin attention in Needs you", () => {
  it("reads only enabled plugins, supplies missing fields, and renders an Open fallback", () => {
    const dir = pluginNeedsDir(home);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "fake-plugin.json"), JSON.stringify({ items: [{ id: "attention", title: "Review fake report", reason: "Waiting on John", href: "/fake/report" }, {}] }));
    const needs = readPluginNeeds("work", { home });
    expect(needs).toHaveLength(2);
    expect(needs[0]).toMatchObject({ entityId: "plugin:fake-plugin:attention", title: "Review fake report", needed: "Waiting on John", href: "/fake/report", action: "open" });
    expect(needs[1]).toMatchObject({ title: "fake-plugin needs you", needed: "Waiting on you", href: "/" });
    const card = formatSlackNeed(needs[1], "n", "CCHANNEL");
    expect(JSON.stringify(card)).toContain("devhub_open");
    expect(JSON.stringify(card)).not.toContain("devhub_need_plan");
    registry(false);
    expect(readPluginNeeds("work", { home })).toEqual([]);
  });

  it("rejects off-site links and tolerates missing, malformed and oversized files", () => {
    for (const href of ["https://evil.test", "//evil.test", "/\\evil.test"]) expect(normalizePluginNeed("fake", "work", { href }, 0).href).toBe("/");
    const dir = pluginNeedsDir(home);
    expect(readPluginNeeds("work", { home })).toEqual([]);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "fake-plugin.json"), "not-json");
    expect(readPluginNeeds("work", { home })).toEqual([]);
    fs.writeFileSync(path.join(dir, "fake-plugin.json"), " ".repeat(256 * 1024 + 1));
    expect(readPluginNeeds("work", { home })).toEqual([]);
  });
});
