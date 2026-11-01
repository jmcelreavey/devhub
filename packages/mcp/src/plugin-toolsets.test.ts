import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readManifest } from "../../../apps/core/src/lib/plugins/manifest";
import runtimeTemplate from "../../../templates/runtime-plugin/devhub-plugin.json";
import { createContext } from "./context.ts";
import { loadPluginToolsets } from "./plugin-toolsets.ts";
import { coreToolNames, createConfiguredDevhubMcpServer, createDevhubMcpServer, loadConfiguredPluginToolsets, TOOLSET_NAMES } from "./server.ts";

let root: string;
let plugin: string;
let config: string;
let sentinel: string;
let errors: string[];

function writeRegistry(entries: unknown[]): void {
  fs.writeFileSync(path.join(config, "plugins.json"), JSON.stringify({ plugins: entries }));
}

function writeDescriptor(toolsets: object[]): void {
  fs.writeFileSync(path.join(plugin, "devhub-mcp-toolsets.json"), JSON.stringify({ version: 1, toolsets }));
}

function descriptor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: "fixture", module: "src/entry.mjs", export: "register", tools: ["fixture_read"], ...overrides };
}

function options() {
  return { home: root, env: { DEVHUB_CONFIG_DIR: config }, reservedToolsets: ["notes"], reservedTools: new Set(["notes_read"]), onError: (message: string) => errors.push(message) };
}

async function expectRejected(pattern: RegExp): Promise<void> {
  errors = [];
  expect(await loadPluginToolsets(options())).toEqual([]);
  expect(errors.join("\n")).toMatch(pattern);
}

function enabled(pathname = plugin, name = "fixture"): object {
  return { name, path: pathname, enabled: true };
}

function makePlugin(name: string, tool: string, overrides: Record<string, unknown> = {}): { directory: string; sentinel: string } {
  const directory = path.join(root, name);
  const marker = path.join(root, `${name}-executed`);
  fs.mkdirSync(path.join(directory, "src"), { recursive: true });
  fs.writeFileSync(path.join(directory, "devhub-plugin.json"), JSON.stringify({ name, version: "1", devhubApi: "1", contributes: {} }));
  fs.writeFileSync(path.join(directory, "devhub-mcp-toolsets.json"), JSON.stringify({ version: 1, toolsets: [descriptor({ name, tools: [tool], ...overrides })] }));
  fs.writeFileSync(path.join(directory, "src", "entry.mjs"), `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(marker)}, "yes");\nexport function register(server) { server.registerTool(${JSON.stringify(tool)}, { description: "Fixture" }, async () => ({ content: [{ type: "text", text: "ok" }] })); }\n`);
  return { directory, sentinel: marker };
}

async function listTools(server: McpServer) {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
    await server.close();
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-plugin-mcp-"));
  plugin = path.join(root, "plugin");
  config = path.join(root, "config");
  sentinel = path.join(root, "executed");
  errors = [];
  fs.mkdirSync(path.join(plugin, "src"), { recursive: true });
  fs.mkdirSync(config);
  fs.writeFileSync(path.join(plugin, "devhub-plugin.json"), JSON.stringify({ name: "fixture", version: "1", devhubApi: "1", contributes: {} }));
  fs.writeFileSync(path.join(plugin, "src", "entry.mjs"), `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(sentinel)}, "yes");\nexport function register(server) { server.registerTool("fixture_read", { description: "Fixture", annotations: { readOnlyHint: true } }, async () => ({ content: [{ type: "text", text: "ok" }] })); }\n`);
  writeDescriptor([descriptor()]);
  vi.stubEnv("REPO_ROOT", root);
  vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
  vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
  vi.stubEnv("DOCS_DIR", path.join(root, "docs"));
  vi.stubEnv("DEVHUB_MCP_HISTORY", "0");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("plugin MCP trust boundary", () => {
  it("preserves core tool metadata with no registry or a disabled plugin", async () => {
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_HISTORY: "0" };
    const baseline = await listTools(createDevhubMcpServer(ctx, env).server);
    expect(TOOLSET_NAMES).not.toContain("appraisal");
    expect(baseline.some((item) => item.name === "appraisal_record")).toBe(false);
    expect(TOOLSET_NAMES).not.toContain("datadog");
    expect(baseline.some((item) => item.name === "datadog_oncall")).toBe(false);
    for (const tool of ["task_ask_teammate", "task_handoff", "integrations_slack_status", "integrations_slack_usage", "integrations_slack_test"]) {
      expect(baseline.some((item) => item.name === tool)).toBe(false);
    }
    expect(await listTools((await createConfiguredDevhubMcpServer(ctx, env)).server)).toEqual(baseline);
    writeRegistry([{ ...enabled(), enabled: false }]);
    expect(await listTools((await createConfiguredDevhubMcpServer(ctx, env)).server)).toEqual(baseline);
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  it("checks global core collisions while off without importing plugin entries", async () => {
    const valid = makePlugin("valid", "valid_read");
    writeDescriptor([descriptor({ name: "fixture-tasks", extends: "tasks", tools: ["tasks_list"] })]);
    writeRegistry([enabled(), enabled(valid.directory, "valid")]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "off", DEVHUB_MCP_HISTORY: "0" };
    const plugins = await loadPluginToolsets({ home: root, env, reservedToolsets: TOOLSET_NAMES, reservedTools: () => coreToolNames(ctx), onError: (message) => errors.push(message) });
    expect(plugins.map((item) => item.plugin)).toEqual(["valid"]);
    expect(errors.join("\n")).toContain("MCP tool collision: tasks_list");
    expect(fs.existsSync(sentinel)).toBe(false);
    expect(fs.existsSync(valid.sentinel)).toBe(false);
    const configured = createDevhubMcpServer(ctx, env, plugins);
    expect(configured.toolsets).toEqual({ names: [], unknown: [] });
    await configured.server.close();
  });

  it("imports unchanged plugin code once across HTTP startup and in-memory sessions", async () => {
    fs.writeFileSync(path.join(plugin, "src", "entry.mjs"), 'import fs from "node:fs"; fs.appendFileSync(' + JSON.stringify(sentinel) + ', "x"); export function register(server) { server.registerTool("fixture_read", { description: "Fixture" }, async () => ({ content: [] })); }');
    writeRegistry([enabled()]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "fixture", DEVHUB_MCP_HISTORY: "0" };
    expect((await loadConfiguredPluginToolsets(ctx, env)).map((item) => item.name)).toEqual(["fixture"]);
    for (let session = 0; session < 3; session += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const configured = await createConfiguredDevhubMcpServer(ctx, env);
      expect(configured.toolsets.names).toEqual(["fixture"]);
      expect((await listTools(configured.server)).some((tool) => tool.name === "fixture_read")).toBe(true);
    }
    expect(fs.readFileSync(sentinel, "utf8")).toBe("x");
  });

  it("deduplicates concurrent session imports", async () => {
    fs.writeFileSync(path.join(plugin, "src", "entry.mjs"), 'import fs from "node:fs"; fs.appendFileSync(' + JSON.stringify(sentinel) + ', "x"); export function register(server) { server.registerTool("fixture_read", { description: "Fixture" }, async () => ({ content: [] })); }');
    writeRegistry([enabled()]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "fixture", DEVHUB_MCP_HISTORY: "0" };
    const sessions = await Promise.all(Array.from({ length: 4 }, () => createConfiguredDevhubMcpServer(ctx, env)));
    for (const session of sessions) {
      expect((await listTools(session.server)).some((tool) => tool.name === "fixture_read")).toBe(true);
    }
    expect(fs.readFileSync(sentinel, "utf8")).toBe("x");
  });

  it.each(["tool", "export", "dependencies", "module", "descriptor", "manifest"])("revokes an initialized session when its %s declaration changes", async (change) => {
    const dependency = path.join(plugin, "src", "dependency.mjs");
    const descriptorFile = path.join(plugin, "devhub-mcp-toolsets.json");
    const manifestFile = path.join(plugin, "devhub-plugin.json");
    const valid = makePlugin("valid", "valid_read");
    fs.writeFileSync(dependency, "export const value = 'declared';");
    fs.writeFileSync(path.join(plugin, "src", "entry.mjs"), 'import fs from "node:fs"; fs.appendFileSync(' + JSON.stringify(sentinel) + ', "x"); export function register(server) { server.registerTool("fixture_read", { description: "Fixture" }, async () => ({ content: [{ type: "text", text: "ok" }] })); }');
    writeDescriptor([descriptor({ dependencies: ["src/dependency.mjs"] })]);
    const originalDescriptor = fs.readFileSync(descriptorFile);
    const originalManifest = fs.readFileSync(manifestFile);
    writeRegistry([enabled(), enabled(valid.directory, "valid")]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "fixture,valid", DEVHUB_MCP_HISTORY: "0" };
    const configured = await createConfiguredDevhubMcpServer(ctx, env);
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await Promise.all([configured.server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      expect(await client.callTool({ name: "fixture_read", arguments: {} })).toMatchObject({ content: [{ type: "text", text: "ok" }] });
      if (change === "tool") writeDescriptor([descriptor({ tools: ["replacement_read"], dependencies: ["src/dependency.mjs"] })]);
      if (change === "export") writeDescriptor([descriptor({ export: "differentRegister", dependencies: ["src/dependency.mjs"] })]);
      if (change === "dependencies") writeDescriptor([descriptor()]);
      if (change === "module") {
        fs.writeFileSync(path.join(plugin, "src", "replacement.mjs"), 'import fs from "node:fs"; fs.appendFileSync(' + JSON.stringify(sentinel) + ', "y"); export function register(server) { server.registerTool("fixture_read", { description: "Replacement" }, async () => ({ content: [] })); }');
        writeDescriptor([descriptor({ module: "src/replacement.mjs", dependencies: ["src/dependency.mjs"] })]);
      }
      if (change === "descriptor") fs.unlinkSync(descriptorFile);
      if (change === "manifest") fs.writeFileSync(manifestFile, JSON.stringify({ name: "fixture", version: "2", devhubApi: "1", contributes: {} }));
      expect(await client.callTool({ name: "fixture_read", arguments: {} })).toMatchObject({ isError: true });
      expect(await client.callTool({ name: "valid_read", arguments: {} })).toMatchObject({ content: [{ type: "text", text: "ok" }] });
      const next = await createConfiguredDevhubMcpServer(ctx, env);
      expect((await listTools(next.server)).map((tool) => tool.name)).not.toContain("fixture_read");
      fs.writeFileSync(descriptorFile, originalDescriptor);
      fs.writeFileSync(manifestFile, originalManifest);
      expect(await client.callTool({ name: "fixture_read", arguments: {} })).toMatchObject({ content: [{ type: "text", text: "ok" }] });
      expect(fs.readFileSync(sentinel, "utf8")).toBe("x");
    } finally {
      await client.close();
      await configured.server.close();
    }
  });

  it.each(["entry", "dependency"])("rejects an oversized source %s without blocking another plugin", async (kind) => {
    const valid = makePlugin("valid", "valid_read");
    const oversized = path.join(plugin, "src", kind === "entry" ? "entry.mjs" : "dependency.mjs");
    fs.writeFileSync(oversized, "");
    fs.truncateSync(oversized, 1024 * 1024 + 1);
    if (kind === "dependency") writeDescriptor([descriptor({ dependencies: ["src/dependency.mjs"] })]);
    writeRegistry([enabled(), enabled(valid.directory, "valid")]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "fixture,valid", DEVHUB_MCP_HISTORY: "0" };
    expect((await loadPluginToolsets({ ...options(), env, reservedToolsets: TOOLSET_NAMES, reservedTools: coreToolNames(ctx) })).map((item) => item.plugin)).toEqual(["valid"]);
    expect(errors.join("\n")).toMatch(/source.*byte limit/i);
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  it("rejects a declared source budget above the aggregate byte limit before import", async () => {
    const dependencies: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const relative = "src/dependency-" + index + ".mjs";
      const file = path.join(plugin, relative);
      fs.writeFileSync(file, "");
      fs.truncateSync(file, 1024 * 1024);
      dependencies.push(relative);
    }
    writeDescriptor([descriptor({ dependencies })]);
    writeRegistry([enabled()]);
    expect(await loadPluginToolsets(options())).toEqual([]);
    expect(errors.join("\n")).toMatch(/source.*byte limit/i);
    expect(fs.existsSync(sentinel)).toBe(false);
  });


  it("rejects a declared dependency that grows beyond its bound in an existing session", async () => {
    const dependency = path.join(plugin, "src", "dependency.mjs");
    const original = "export const value = 'small';";
    fs.writeFileSync(dependency, original);
    writeDescriptor([descriptor({ dependencies: ["src/dependency.mjs"] })]);
    const valid = makePlugin("valid", "valid_read");
    writeRegistry([enabled(), enabled(valid.directory, "valid")]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "fixture,valid", DEVHUB_MCP_HISTORY: "0" };
    const configured = await createConfiguredDevhubMcpServer(ctx, env);
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await Promise.all([configured.server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      expect(await client.callTool({ name: "fixture_read", arguments: {} })).toMatchObject({ content: [{ type: "text", text: "ok" }] });
      fs.truncateSync(dependency, 1024 * 1024 + 1);
      const readFile = vi.spyOn(fs, "readFileSync");
      expect(await client.callTool({ name: "fixture_read", arguments: {} })).toMatchObject({ isError: true });
      expect(readFile.mock.calls.some(([file]) => file === dependency)).toBe(false);
      expect(await client.callTool({ name: "valid_read", arguments: {} })).toMatchObject({ content: [{ type: "text", text: "ok" }] });
      fs.writeFileSync(dependency, original);
      expect(await client.callTool({ name: "fixture_read", arguments: {} })).toMatchObject({ content: [{ type: "text", text: "ok" }] });
    } finally {
      await client.close();
      await configured.server.close();
    }
  });

  it("accepts a declared source file exactly at its byte limit", async () => {
    const dependency = path.join(plugin, "src", "dependency.mjs");
    fs.writeFileSync(dependency, "");
    fs.truncateSync(dependency, 1024 * 1024);
    writeDescriptor([descriptor({ dependencies: ["src/dependency.mjs"] })]);
    writeRegistry([enabled()]);
    expect((await loadPluginToolsets(options())).map((item) => item.plugin)).toEqual(["fixture"]);
    expect(fs.existsSync(sentinel)).toBe(true);
  });


  it.each(["entry", "dependency"])("revokes a session when its declared %s changes without affecting other plugins", async (changedFile) => {
    const entryPath = path.join(plugin, "src", "entry.mjs");
    const dependencyPath = path.join(plugin, "src", "dependency.mjs");
    const entry = (marker: string) => 'import fs from "node:fs"; import { value } from "./dependency.mjs"; fs.appendFileSync(' + JSON.stringify(sentinel) + ', ' + JSON.stringify(marker) + '); export function register(server) { server.registerTool("fixture_read", { description: "Fixture" }, async () => ({ content: [{ type: "text", text: value }] })); }';
    const originalDependency = 'export const value = "old";';
    fs.writeFileSync(entryPath, entry("x"));
    fs.writeFileSync(dependencyPath, originalDependency);
    writeDescriptor([descriptor({ dependencies: ["src/dependency.mjs"] })]);
    const valid = makePlugin("valid", "valid_read");
    writeRegistry([enabled(), enabled(valid.directory, "valid")]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "fixture,valid", DEVHUB_MCP_HISTORY: "0" };
    const load = () => loadPluginToolsets({ ...options(), env, reservedToolsets: TOOLSET_NAMES, reservedTools: coreToolNames(ctx) });
    const plugins = await load();
    const configured = createDevhubMcpServer(ctx, env, plugins);
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await Promise.all([configured.server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      expect(await client.callTool({ name: "fixture_read", arguments: {} })).toMatchObject({ content: [{ type: "text", text: "old" }] });
      if (changedFile === "entry") fs.writeFileSync(entryPath, entry("y"));
      else fs.writeFileSync(dependencyPath, 'export const value = "new";');
      expect(await client.callTool({ name: "fixture_read", arguments: {} })).toMatchObject({ isError: true });
      expect(await client.callTool({ name: "valid_read", arguments: {} })).toMatchObject({ content: [{ type: "text", text: "ok" }] });
      errors = [];
      expect((await load()).map((item) => item.plugin)).toEqual(["valid"]);
      expect(errors.join("\n")).toMatch(/source changed.*restart/i);
      expect(fs.readFileSync(sentinel, "utf8")).toBe("x");
      fs.writeFileSync(entryPath, entry("x"));
      fs.writeFileSync(dependencyPath, originalDependency);
      expect(await client.callTool({ name: "fixture_read", arguments: {} })).toMatchObject({ content: [{ type: "text", text: "old" }] });
      expect((await load()).map((item) => item.plugin)).toEqual(["fixture", "valid"]);
      expect(fs.readFileSync(sentinel, "utf8")).toBe("x");
    } finally {
      await client.close();
      await configured.server.close();
    }
  });

  it("does not fingerprint undeclared imports or mutable plugin assets", async () => {
    const dependency = path.join(plugin, "src", "undeclared.mjs");
    const asset = path.join(plugin, "asset.json");
    fs.writeFileSync(dependency, 'export const value = "old";');
    fs.writeFileSync(asset, "one");
    fs.writeFileSync(path.join(plugin, "src", "entry.mjs"), 'import fs from "node:fs"; import { value } from "./undeclared.mjs"; fs.appendFileSync(' + JSON.stringify(sentinel) + ', "x"); export function register(server) { server.registerTool("fixture_read", { description: "Fixture" }, async () => ({ content: [{ type: "text", text: value + ":" + fs.readFileSync(' + JSON.stringify(asset) + ', "utf8") }] })); }');
    writeRegistry([enabled()]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "fixture", DEVHUB_MCP_HISTORY: "0" };
    const configured = await createConfiguredDevhubMcpServer(ctx, env);
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await Promise.all([configured.server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      expect(await client.callTool({ name: "fixture_read", arguments: {} })).toMatchObject({ content: [{ type: "text", text: "old:one" }] });
      fs.writeFileSync(dependency, 'export const value = "new";');
      fs.writeFileSync(asset, "two");
      expect(await client.callTool({ name: "fixture_read", arguments: {} })).toMatchObject({ content: [{ type: "text", text: "old:two" }] });
      writeRegistry([{ ...enabled(), enabled: false }]);
      expect(await client.callTool({ name: "fixture_read", arguments: {} })).toMatchObject({ isError: true });
      writeRegistry([enabled()]);
      expect(await client.callTool({ name: "fixture_read", arguments: {} })).toMatchObject({ content: [{ type: "text", text: "old:two" }] });
      const next = await createConfiguredDevhubMcpServer(ctx, env);
      expect((await listTools(next.server)).some((tool) => tool.name === "fixture_read")).toBe(true);
      expect(fs.readFileSync(sentinel, "utf8")).toBe("x");
    } finally {
      await client.close();
      await configured.server.close();
    }
  });

  it("reuses unchanged code after disable and re-enable while revoking disabled calls", async () => {
    fs.writeFileSync(path.join(plugin, "src", "entry.mjs"), 'import fs from "node:fs"; fs.appendFileSync(' + JSON.stringify(sentinel) + ', "x"); export function register(server) { server.registerTool("fixture_read", { description: "Fixture" }, async () => ({ content: [{ type: "text", text: "ok" }] })); }');
    writeRegistry([enabled()]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "fixture", DEVHUB_MCP_HISTORY: "0" };
    const configured = await createConfiguredDevhubMcpServer(ctx, env);
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await Promise.all([configured.server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      expect(await client.callTool({ name: "fixture_read", arguments: {} })).toMatchObject({ content: [{ type: "text", text: "ok" }] });
      writeRegistry([{ ...enabled(), enabled: false }]);
      expect(await client.callTool({ name: "fixture_read", arguments: {} })).toMatchObject({ isError: true });
      const disabled = await createConfiguredDevhubMcpServer(ctx, env);
      expect(disabled.toolsets.names).toEqual([]);
      expect(disabled.availableToolsets).not.toContain("fixture");
      await disabled.server.close();
      writeRegistry([enabled()]);
      expect(await client.callTool({ name: "fixture_read", arguments: {} })).toMatchObject({ content: [{ type: "text", text: "ok" }] });
      const reenabled = await createConfiguredDevhubMcpServer(ctx, env);
      expect((await listTools(reenabled.server)).some((tool) => tool.name === "fixture_read")).toBe(true);
      expect(fs.readFileSync(sentinel, "utf8")).toBe("x");
    } finally {
      await client.close();
      await configured.server.close();
    }
  });

  it("does not poison the cache when a plugin is disabled before import begins", async () => {
    fs.writeFileSync(path.join(plugin, "src", "entry.mjs"), 'import fs from "node:fs"; fs.appendFileSync(' + JSON.stringify(sentinel) + ', "x"); export function register(server) { server.registerTool("fixture_read", { description: "Fixture" }, async () => ({ content: [] })); }');
    writeRegistry([enabled()]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "fixture", DEVHUB_MCP_HISTORY: "0" };
    const load = () => loadPluginToolsets({ ...options(), env, reservedToolsets: TOOLSET_NAMES, reservedTools: coreToolNames(ctx) });
    const pending = load();
    writeRegistry([{ ...enabled(), enabled: false }]);
    expect(await pending).toEqual([]);
    expect(fs.existsSync(sentinel)).toBe(false);
    writeRegistry([enabled()]);
    expect((await load()).map((item) => item.plugin)).toEqual(["fixture"]);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("x");
  });

  it("requires a restart when a module path changes plugin identity", async () => {
    writeRegistry([enabled()]);
    const initial = await loadPluginToolsets(options());
    expect(initial.map((item) => item.plugin)).toEqual(["fixture"]);
    fs.writeFileSync(path.join(plugin, "devhub-plugin.json"), JSON.stringify({ name: "renamed", version: "1", devhubApi: "1", contributes: {} }));
    writeRegistry([enabled(plugin, "renamed")]);
    expect(initial[0].isEnabled()).toBe(false);
    errors = [];
    expect(await loadPluginToolsets(options())).toEqual([]);
    expect(errors.join("\n")).toMatch(/source changed.*restart/i);
  });

  it("does not expose a plugin disabled during module evaluation", async () => {
    const valid = makePlugin("valid", "valid_read");
    const entries = [enabled(), enabled(valid.directory, "valid")];
    const disabled = [{ ...enabled(), enabled: false }, enabled(valid.directory, "valid")];
    fs.writeFileSync(path.join(plugin, "src", "entry.mjs"), 'import fs from "node:fs"; fs.writeFileSync(' + JSON.stringify(path.join(config, "plugins.json")) + ', ' + JSON.stringify(JSON.stringify({ plugins: disabled })) + '); fs.appendFileSync(' + JSON.stringify(sentinel) + ', "x"); export function register(server) { server.registerTool("fixture_read", { description: "Fixture" }, async () => ({ content: [] })); }');
    writeRegistry(entries);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "fixture,valid", DEVHUB_MCP_HISTORY: "0" };
    const load = () => loadPluginToolsets({ ...options(), env, reservedToolsets: TOOLSET_NAMES, reservedTools: coreToolNames(ctx) });
    expect((await load()).map((item) => item.plugin)).toEqual(["valid"]);
    expect(errors.join("\n")).toMatch(/no longer enabled/i);
    writeRegistry(entries);
    expect((await load()).map((item) => item.plugin)).toEqual(["fixture", "valid"]);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("x");
  });

  it("does not expose a module replaced during evaluation", async () => {
    const entryPath = path.join(plugin, "src", "entry.mjs");
    const valid = makePlugin("valid", "valid_read");
    fs.writeFileSync(entryPath, 'import fs from "node:fs"; fs.appendFileSync(' + JSON.stringify(entryPath) + ', " "); fs.appendFileSync(' + JSON.stringify(sentinel) + ', "x"); export function register(server) { server.registerTool("fixture_read", { description: "Fixture" }, async () => ({ content: [] })); }');
    writeRegistry([enabled(), enabled(valid.directory, "valid")]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "fixture,valid", DEVHUB_MCP_HISTORY: "0" };
    const load = () => loadPluginToolsets({ ...options(), env, reservedToolsets: TOOLSET_NAMES, reservedTools: coreToolNames(ctx) });
    expect((await load()).map((item) => item.plugin)).toEqual(["valid"]);
    expect(errors.join("\n")).toMatch(/source changed.*restart/i);
    errors = [];
    expect((await load()).map((item) => item.plugin)).toEqual(["valid"]);
    expect(errors.join("\n")).toMatch(/source changed.*restart/i);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("x");
  });

  it.each(["replacement", "failure", "descriptor", "manifest"])("does not publish tools after an in-flight import %s", async (outcome) => {
    const entryPath = path.join(plugin, "src", "entry.mjs");
    const release = path.join(root, "release");
    const valid = makePlugin("valid", "valid_read");
    const wait = 'await new Promise((resolve, reject) => { const timer = setInterval(() => { if (fs.existsSync(' + JSON.stringify(release) + ')) { clearInterval(timer); clearTimeout(timeout); resolve(); } }, 10); const timeout = setTimeout(() => { clearInterval(timer); reject(new Error("test gate timed out")); }, 5000); });';
    const failure = outcome === "failure" ? 'throw new Error("deliberate in-flight failure");' : "";
    fs.writeFileSync(entryPath, 'import fs from "node:fs"; fs.appendFileSync(' + JSON.stringify(sentinel) + ', "x"); ' + wait + failure + ' export function register(server) { server.registerTool("fixture_read", { description: "Fixture" }, async () => ({ content: [] })); }');
    writeRegistry([enabled(), enabled(valid.directory, "valid")]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "fixture,valid", DEVHUB_MCP_HISTORY: "0" };
    const load = () => loadPluginToolsets({ ...options(), env, reservedToolsets: TOOLSET_NAMES, reservedTools: coreToolNames(ctx) });
    const pending = Promise.all([load(), load()]);
    try {
      await vi.waitFor(() => expect(fs.existsSync(sentinel)).toBe(true), { timeout: 3000, interval: 10 });
      if (outcome === "replacement") fs.writeFileSync(entryPath, 'export function register() {}');
      if (outcome === "descriptor") writeDescriptor([descriptor({ export: "differentRegister" })]);
      if (outcome === "manifest") fs.writeFileSync(path.join(plugin, "devhub-plugin.json"), JSON.stringify({ name: "fixture", version: "2", devhubApi: "1", contributes: {} }));
    } finally {
      fs.writeFileSync(release, "go");
    }
    const sessions = await pending;
    for (const plugins of sessions) {
      expect(plugins.map((item) => item.plugin)).toEqual(["valid"]);
      expect((await listTools(createDevhubMcpServer(ctx, env, plugins).server)).map((tool) => tool.name)).toEqual(["valid_read"]);
    }
    expect(errors.join("\n")).toMatch(outcome === "failure" ? /deliberate in-flight failure/i : /changed.*restart/i);
    errors = [];
    expect((await load()).map((item) => item.plugin)).toEqual(["valid"]);
    expect(errors.join("\n")).toMatch(outcome === "failure" ? /deliberate in-flight failure/i : /changed.*restart/i);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("x");
  });

  it.each([
    ["off", false, false],
    ["notes", false, false],
    ["tasks", false, true],
    ["fixture", true, false],
    ["tasks,fixture", true, true],
  ])("imports only entries selected by %s", async (selection, standaloneSelected, tasksSelected) => {
    const taskMarker = path.join(root, "task-executed");
    fs.writeFileSync(path.join(plugin, "src", "task.mjs"), 'import fs from "node:fs"; fs.writeFileSync(' + JSON.stringify(taskMarker) + ', "yes"); export function register(server) { server.registerTool("fixture_task", { description: "Task fixture" }, async () => ({ content: [] })); }');
    writeDescriptor([
      descriptor(),
      descriptor({ name: "fixture-tasks", extends: "tasks", module: "src/task.mjs", tools: ["fixture_task"] }),
    ]);
    writeRegistry([enabled()]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: selection, DEVHUB_MCP_HISTORY: "0" };
    const plugins = await loadPluginToolsets({ home: root, env, reservedToolsets: TOOLSET_NAMES, reservedTools: () => coreToolNames(ctx) });
    expect(fs.existsSync(sentinel)).toBe(standaloneSelected);
    expect(fs.existsSync(taskMarker)).toBe(tasksSelected);
    const configured = createDevhubMcpServer(ctx, env, plugins);
    expect(configured.availableToolsets).toContain("fixture");
    if (selection === "off") {
      expect(configured.toolsets).toEqual({ names: [], unknown: [] });
      await configured.server.close();
      return;
    }
    const tools = await listTools(configured.server);
    expect(tools.some((tool) => tool.name === "fixture_read")).toBe(standaloneSelected);
    expect(tools.some((tool) => tool.name === "fixture_task")).toBe(tasksSelected);
    if (tasksSelected) expect(tools.find((tool) => tool.name === "fixture_task")?._meta).toMatchObject({ "devhub/toolset": "tasks" });
  });

  it("rejects selection sentinels as plugin toolset names before import", async () => {
    writeRegistry([enabled()]);
    for (const name of ["off", "all"]) {
      writeDescriptor([descriptor({ name })]);
      await expectRejected(/toolset collision/);
      expect(fs.existsSync(sentinel)).toBe(false);
    }
  });

  it("validates collisions in unselected groups before importing selected plugins", async () => {
    const conflicting = makePlugin("conflicting", "fixture_read", { name: "conflicting-tasks", extends: "tasks" });
    const valid = makePlugin("valid", "valid_read");
    writeRegistry([enabled(), enabled(conflicting.directory, "conflicting"), enabled(valid.directory, "valid")]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "fixture,valid", DEVHUB_MCP_HISTORY: "0" };
    const plugins = await loadPluginToolsets({ home: root, env, reservedToolsets: TOOLSET_NAMES, reservedTools: () => coreToolNames(ctx), onError: (message) => errors.push(message) });
    expect(plugins.map((item) => item.plugin)).toEqual(["valid"]);
    expect(errors.join("\n")).toMatch(/tool collision: fixture_read/);
    expect(fs.existsSync(sentinel)).toBe(false);
    expect(fs.existsSync(conflicting.sentinel)).toBe(false);
    expect(fs.existsSync(valid.sentinel)).toBe(true);
  });

  it("does not import an unselected broken entry from a selected plugin", async () => {
    fs.writeFileSync(path.join(plugin, "src", "broken.mjs"), 'throw new Error("unselected entry imported");');
    writeDescriptor([
      descriptor(),
      descriptor({ name: "fixture-tasks", extends: "tasks", module: "src/broken.mjs", tools: ["fixture_task"] }),
    ]);
    writeRegistry([enabled()]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "fixture", DEVHUB_MCP_HISTORY: "0" };
    const plugins = await loadPluginToolsets({ home: root, env, reservedToolsets: TOOLSET_NAMES, reservedTools: () => coreToolNames(ctx), onError: (message) => errors.push(message) });
    expect(errors).toEqual([]);
    expect(fs.existsSync(sentinel)).toBe(true);
    expect((await listTools(createDevhubMcpServer(ctx, env, plugins).server)).some((tool) => tool.name === "fixture_read")).toBe(true);
  });

  it("fails closed if an unloaded group is selected after discovery", async () => {
    writeRegistry([enabled()]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "notes", DEVHUB_MCP_HISTORY: "0" };
    const plugins = await loadPluginToolsets({ home: root, env, reservedToolsets: TOOLSET_NAMES, reservedTools: () => coreToolNames(ctx) });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const configured = createDevhubMcpServer(ctx, { ...env, DEVHUB_MCP_TOOLSETS: "fixture" }, plugins);
    expect(configured.toolsets.names).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("not loaded"));
    expect(fs.existsSync(sentinel)).toBe(false);
    await configured.server.close();
  });

  it("does not execute disabled, managed, malformed, or implicitly enabled entries", async () => {
    for (const entry of [
      { ...enabled(), enabled: false },
      { ...enabled(), managed: true },
      { ...enabled(), managed: "true" },
      { name: "fixture", path: plugin },
    ]) {
      writeRegistry([entry]);
      expect(await loadPluginToolsets(options())).toEqual([]);
      expect(fs.existsSync(sentinel)).toBe(false);
    }
  });

  it.each([
    ["unknown contribution", { contributes: { unknown: "assets" } }],
    ["invalid contribution", { contributes: { skills: 42 } }],
    ["unknown top-level field", { unexpected: true }],
    ["invalid dashboard contribution", { dashboard: { root: "dashboard", paths: ["app/page"], nav: [{ href: "/example", label: "Example", icon: "Circle", group: "workspace", shortcut: 42 }] } }],
    ["invalid runtime contribution", { runtime: {} }],
  ])("rejects dashboard-invalid manifest before import: %s", async (_label, patch) => {
    const valid = makePlugin("valid", "valid_read");
    const manifest = { name: "fixture", version: "1", devhubApi: "1", contributes: {}, ...patch };
    fs.writeFileSync(path.join(plugin, "devhub-plugin.json"), JSON.stringify(manifest));
    writeRegistry([enabled(), enabled(valid.directory, "valid")]);
    expect(readManifest(plugin).ok).toBe(false);
    expect((await loadPluginToolsets(options())).map((item) => item.plugin)).toEqual(["valid"]);
    expect(errors.join("\n")).toMatch(/Invalid MCP plugin manifest/);
    expect(fs.existsSync(sentinel)).toBe(false);
    expect(fs.existsSync(valid.sentinel)).toBe(true);
  });

  it("accepts a dashboard-valid manifest with runtime and navigation contributions", async () => {
    const manifest = {
      ...runtimeTemplate,
      name: "fixture",
      dashboard: { root: "dashboard", paths: ["app/page"], nav: [{ href: "/example", label: "Example", icon: "Circle", group: "workspace" }] },
    };
    fs.writeFileSync(path.join(plugin, "devhub-plugin.json"), JSON.stringify(manifest));
    writeRegistry([enabled()]);
    expect(readManifest(plugin).ok).toBe(true);
    expect((await loadPluginToolsets(options())).map((item) => item.plugin)).toEqual(["fixture"]);
    expect(fs.existsSync(sentinel)).toBe(true);
  });

  it.each([
    [128 * 1024 + 1, true],
    [256 * 1024, true],
    [256 * 1024 + 1, false],
  ])("matches the dashboard manifest size limit at %i bytes", async (size, accepted) => {
    const manifest = JSON.stringify({ name: "fixture", version: "1", devhubApi: "1", contributes: {} });
    fs.writeFileSync(path.join(plugin, "devhub-plugin.json"), manifest + " ".repeat(size - Buffer.byteLength(manifest)));
    writeRegistry([enabled()]);
    expect(readManifest(plugin).ok).toBe(accepted);
    expect((await loadPluginToolsets(options())).map((item) => item.plugin)).toEqual(accepted ? ["fixture"] : []);
    expect(fs.existsSync(sentinel)).toBe(accepted);
  });

  it("revokes advertised tools when the plugin manifest becomes invalid", async () => {
    writeRegistry([enabled()]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "fixture", DEVHUB_MCP_HISTORY: "0" };
    const plugins = await loadPluginToolsets({ home: root, env, reservedToolsets: TOOLSET_NAMES, reservedTools: coreToolNames(ctx) });
    const { server } = createDevhubMcpServer(ctx, env, plugins);
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      expect(await client.callTool({ name: "fixture_read", arguments: {} })).toMatchObject({ content: [{ type: "text", text: "ok" }] });
      fs.writeFileSync(path.join(plugin, "devhub-plugin.json"), JSON.stringify({ name: "fixture", version: "1", devhubApi: "1", contributes: { unknown: "assets" } }));
      expect(readManifest(plugin).ok).toBe(false);
      expect(await client.callTool({ name: "fixture_read", arguments: {} })).toMatchObject({ isError: true });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("rejects traversal, absolute paths and non-portable paths before executing code", async () => {
    writeRegistry([enabled()]);
    for (const module of ["../entry.mjs", "src/../entry.mjs", "/tmp/entry.mjs", "src\\entry.mjs", "src/%2e%2e.mjs"]) {
      writeDescriptor([descriptor({ module })]);
      await expectRejected(/Invalid MCP toolset/);
      expect(fs.existsSync(sentinel)).toBe(false);
    }
  });

  it("rejects root, descriptor, module, parent-directory and dependency symlinks", async () => {
    writeRegistry([enabled()]);
    const alias = path.join(root, "alias");
    fs.symlinkSync(plugin, alias);
    writeRegistry([enabled(alias)]);
    await expectRejected(/real directory/);
    writeRegistry([enabled()]);

    const descriptorPath = path.join(plugin, "devhub-mcp-toolsets.json");
    fs.renameSync(descriptorPath, path.join(root, "descriptor.json"));
    fs.symlinkSync(path.join(root, "descriptor.json"), descriptorPath);
    await expectRejected(/symlink/);
    fs.unlinkSync(descriptorPath);
    fs.renameSync(path.join(root, "descriptor.json"), descriptorPath);

    fs.symlinkSync(path.join(plugin, "src", "entry.mjs"), path.join(plugin, "src", "alias.mjs"));
    writeDescriptor([descriptor({ module: "src/alias.mjs" })]);
    await expectRejected(/symlink/);
    fs.symlinkSync(path.join(plugin, "src"), path.join(plugin, "link"));
    writeDescriptor([descriptor({ module: "link/entry.mjs" })]);
    await expectRejected(/symlink/);
    writeDescriptor([descriptor({ dependencies: ["src/alias.mjs"] })]);
    await expectRejected(/symlink/);
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  it("rejects collisions against core and other plugins before any import", async () => {
    writeRegistry([enabled()]);
    for (const override of [{ name: "notes" }, { tools: ["notes_read"] }, { tools: ["fixture_read", "fixture_read"] }]) {
      writeDescriptor([descriptor(override)]);
      await expectRejected(/collision|Duplicate/);
    }
    writeDescriptor([descriptor(), descriptor({ name: "another", module: "src/entry.mjs", tools: ["other_read"] })]);
    await expectRejected(/module collision/);
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  it.each([
    ["task_ask_teammate", "tasks"],
    ["task_handoff", "tasks"],
    ["integrations_slack_status", "integrations"],
    ["integrations_slack_usage", "integrations"],
    ["integrations_slack_test", "integrations"],
  ])("registers plugin %s in the %s toolset", async (tool, group) => {
    const valid = makePlugin("valid", "valid_read");
    fs.writeFileSync(path.join(plugin, "src", "entry.mjs"), 'export function register(server) { server.registerTool(' + JSON.stringify(tool) + ', { description: "Fixture", annotations: { readOnlyHint: true } }, async () => ({ content: [] })); }');
    writeDescriptor([descriptor({ name: "fixture-extension", extends: group, tools: [tool] })]);
    writeRegistry([enabled(), enabled(valid.directory, "valid")]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "tasks,integrations,valid", DEVHUB_MCP_HISTORY: "0" };
    const plugins = await loadPluginToolsets({ home: root, env, reservedToolsets: TOOLSET_NAMES, reservedTools: () => coreToolNames(ctx), onError: (message) => errors.push(message) });
    expect(plugins.map((item) => item.plugin)).toEqual(["fixture", "valid"]);
    expect(errors).toEqual([]);
    expect(fs.existsSync(sentinel)).toBe(false);
    expect(fs.existsSync(valid.sentinel)).toBe(true);
    const tools = await listTools(createDevhubMcpServer(ctx, env, plugins).server);
    expect(tools.find((item) => item.name === tool)?._meta).toMatchObject({ "devhub/toolset": group });
    expect(tools.some((item) => item.name === "valid_read")).toBe(true);
  });

  it("isolates a malformed descriptor without importing it or blocking a valid plugin", async () => {
    const valid = makePlugin("valid", "valid_read");
    writeDescriptor([descriptor({ module: "../entry.mjs" })]);
    writeRegistry([enabled(), enabled(valid.directory, "valid")]);
    const plugins = await loadPluginToolsets(options());
    expect(plugins.map((item) => item.plugin)).toEqual(["valid"]);
    expect(errors.join("\n")).toMatch(/Invalid MCP toolset/);
    expect(fs.existsSync(sentinel)).toBe(false);
    expect(fs.existsSync(valid.sentinel)).toBe(true);
  });

  it("ignores missing plugins and optional descriptors without blocking valid plugins", async () => {
    const valid = makePlugin("valid", "valid_read");
    const optional = path.join(root, "optional");
    fs.mkdirSync(optional);
    fs.writeFileSync(path.join(optional, "devhub-plugin.json"), JSON.stringify({ name: "optional", version: "1", devhubApi: "1", contributes: {} }));
    writeRegistry([enabled(path.join(root, "missing"), "missing"), enabled(optional, "optional"), enabled(valid.directory, "valid")]);
    expect((await loadPluginToolsets(options())).map((item) => item.plugin)).toEqual(["valid"]);
    expect(fs.existsSync(valid.sentinel)).toBe(true);
  });

  it("ignores malformed individual registry entries without blocking valid plugins", async () => {
    const valid = makePlugin("valid", "valid_read");
    writeRegistry([null, 42, "invalid", { name: "broken", path: 12, enabled: true }, enabled(valid.directory, "valid")]);
    expect((await loadPluginToolsets(options())).map((item) => item.plugin)).toEqual(["valid"]);
    expect(fs.existsSync(valid.sentinel)).toBe(true);
  });

  it("rejects all colliding plugins before import while unrelated plugins remain usable", async () => {
    writeDescriptor([descriptor({ name: "task-extension", extends: "tasks", tools: ["shared_fixture"] })]);
    const conflicting = makePlugin("conflicting", "shared_fixture", { name: "integration-extension", extends: "integrations" });
    const valid = makePlugin("valid", "valid_read");
    writeRegistry([enabled(), enabled(conflicting.directory, "conflicting"), enabled(valid.directory, "valid")]);
    const ctx = createContext();
    const plugins = await loadPluginToolsets({ ...options(), reservedToolsets: TOOLSET_NAMES, reservedTools: coreToolNames(ctx) });
    expect(plugins.map((item) => item.plugin)).toEqual(["valid"]);
    expect(errors.join("\n")).toMatch(/tool collision: shared_fixture/);
    expect(fs.existsSync(sentinel)).toBe(false);
    expect(fs.existsSync(conflicting.sentinel)).toBe(false);
    expect(fs.existsSync(valid.sentinel)).toBe(true);
  });

  it("rejects a multi-group contributor that collides with a different core group before import", async () => {
    const valid = makePlugin("valid", "valid_read");
    const otherMarker = path.join(root, "other-executed");
    fs.writeFileSync(path.join(plugin, "src", "other.mjs"), `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(otherMarker)}, "yes"); export function register() {}`);
    writeDescriptor([
      descriptor({ name: "task-extension", extends: "tasks" }),
      descriptor({ name: "integration-extension", extends: "integrations", module: "src/other.mjs", tools: ["tasks_list"] }),
    ]);
    writeRegistry([enabled(), enabled(valid.directory, "valid")]);
    const ctx = createContext();
    const plugins = await loadPluginToolsets({ ...options(), reservedToolsets: TOOLSET_NAMES, reservedTools: coreToolNames(ctx) });
    expect(plugins.map((item) => item.plugin)).toEqual(["valid"]);
    expect(errors.join("\n")).toMatch(/MCP tool collision: tasks_list/);
    expect(fs.existsSync(sentinel)).toBe(false);
    expect(fs.existsSync(otherMarker)).toBe(false);
    expect(fs.existsSync(valid.sentinel)).toBe(true);
  });

  it("keeps valid plugins when another plugin throws during import", async () => {
    const valid = makePlugin("valid", "valid_read");
    fs.writeFileSync(path.join(plugin, "src", "entry.mjs"), 'throw new Error("broken plugin");\n');
    writeRegistry([enabled(), enabled(valid.directory, "valid")]);
    expect((await loadPluginToolsets(options())).map((item) => item.plugin)).toEqual(["valid"]);
    expect(errors.join("\n")).toContain("broken plugin");
  });

  it("does not collect core tool names when there are no eligible descriptors", async () => {
    writeRegistry([{ ...enabled(), enabled: false }]);
    const collect = vi.fn(() => new Set<string>());
    expect(await loadPluginToolsets({ ...options(), reservedTools: collect })).toEqual([]);
    expect(collect).not.toHaveBeenCalled();
  });

  it("collects every core tool name without filesystem or dashboard calls", async () => {
    const ctx = createContext();
    const calls = [
      vi.spyOn(fs, "readdirSync"),
      vi.spyOn(fs, "readFileSync"),
      vi.spyOn(fs, "statSync"),
      vi.spyOn(fs, "existsSync"),
      vi.spyOn(fs, "writeFileSync"),
      vi.spyOn(fs, "appendFileSync"),
      vi.spyOn(fs, "mkdirSync"),
      vi.spyOn(fs, "lstatSync"),
      vi.spyOn(fs, "realpathSync"),
      vi.spyOn(fs, "openSync"),
      vi.spyOn(fs, "unlinkSync"),
      vi.spyOn(fs, "rmSync"),
      vi.spyOn(fs.promises, "readFile"),
      vi.spyOn(fs.promises, "writeFile"),
      vi.spyOn(ctx.dashboard, "get"),
      vi.spyOn(ctx.dashboard, "post"),
      vi.spyOn(ctx, "dashboardInfo", "get"),
    ];
    const names = coreToolNames(ctx);
    for (const call of calls) {
      expect(call).not.toHaveBeenCalled();
      call.mockRestore();
    }
    const { server } = createDevhubMcpServer(ctx, { DEVHUB_MCP_TOOLSETS: "all", DEVHUB_MCP_HISTORY: "0" });
    const actual = await listTools(server);
    expect([...names].sort()).toEqual(actual.map((item) => item.name).sort());
  });

  it("extends a selected core group without changing its baseline or creating a selectable plugin group", async () => {
    writeDescriptor([descriptor({ name: "team-slack", extends: "tasks" })]);
    fs.writeFileSync(path.join(plugin, "src", "entry.mjs"), `export function register(server, ctx, api) { server.registerTool("fixture_read", { description: "Fixture", annotations: { readOnlyHint: true } }, async () => api.withDashboardErrors(async () => { throw new Error("fixture failure"); })); }\n`);
    writeRegistry([enabled()]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "tasks", DEVHUB_MCP_HISTORY: "0" };
    const plugins = await loadPluginToolsets({ home: root, env, reservedToolsets: TOOLSET_NAMES, reservedTools: coreToolNames(ctx) });
    const off = await listTools(createDevhubMcpServer(ctx, env).server);
    const on = createDevhubMcpServer(ctx, env, plugins);
    expect(on.toolsets.names).toEqual(["tasks"]);
    expect(on.availableToolsets).not.toContain("team-slack");
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await Promise.all([on.server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const tools = (await client.listTools()).tools;
      expect(tools.map((item) => item.name).sort()).toEqual([...off.map((item) => item.name), "fixture_read"].sort());
      expect(tools.find((item) => item.name === "fixture_read")).toMatchObject({ annotations: { readOnlyHint: true }, _meta: { "devhub/toolset": "tasks" } });
      expect(await client.callTool({ name: "fixture_read", arguments: {} })).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringContaining("fixture failure") }] });
      writeRegistry([{ ...enabled(), enabled: false }]);
      expect(await client.callTool({ name: "fixture_read", arguments: {} })).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringContaining("no longer enabled") }] });
    } finally {
      await client.close();
      await on.server.close();
    }
    writeRegistry([enabled()]);
    const other = createDevhubMcpServer(ctx, { ...env, DEVHUB_MCP_TOOLSETS: "notes,team-slack" }, plugins);
    expect(other.toolsets).toMatchObject({ names: ["notes"], unknown: ["team-slack"] });
    expect((await listTools(other.server)).some((item) => item.name === "fixture_read")).toBe(false);
  });

  it("preserves combined and separate task/integration selections and metadata", async () => {
    const integrationNames = ["fixture_status", "fixture_usage", "fixture_test"];
    const pluginNames = ["fixture_task", ...integrationNames];
    writeDescriptor([
      descriptor({ name: "team-slack-tasks", extends: "tasks", tools: ["fixture_task"] }),
      descriptor({ name: "team-slack-integrations", extends: "integrations", module: "src/integrations.mjs", tools: integrationNames }),
    ]);
    fs.writeFileSync(path.join(plugin, "src", "entry.mjs"), 'export function register(server) { server.registerTool("fixture_task", { description: "task" }, async () => ({ content: [] })); }');
    fs.writeFileSync(path.join(plugin, "src", "integrations.mjs"), `export function register(server) { for (const name of ${JSON.stringify(integrationNames)}) server.registerTool(name, { description: name }, async () => ({ content: [] })); }`);
    writeRegistry([enabled()]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "tasks,integrations", DEVHUB_MCP_HISTORY: "0" };
    const load = () => loadPluginToolsets({ home: root, env, reservedToolsets: TOOLSET_NAMES, reservedTools: coreToolNames(ctx) });
    const plugins = await load();
    expect(plugins.map((item) => item.name)).toEqual(["team-slack-tasks", "team-slack-integrations"]);
    const off = await listTools(createDevhubMcpServer(ctx, env).server);
    const on = createDevhubMcpServer(ctx, env, plugins);
    expect(on.toolsets.names).toEqual(["tasks", "integrations"]);
    expect(on.availableToolsets).not.toContain("team-slack-tasks");
    expect(on.availableToolsets).not.toContain("team-slack-integrations");
    const tools = await listTools(on.server);
    expect(tools.filter((item) => !pluginNames.includes(item.name))).toEqual(off);
    expect(tools.filter((item) => pluginNames.includes(item.name)).map((item) => item.name).sort()).toEqual([...pluginNames].sort());
    expect(tools.find((item) => item.name === "fixture_task")?._meta).toMatchObject({ "devhub/toolset": "tasks" });
    for (const name of integrationNames) {
      expect(tools.find((item) => item.name === name)?._meta).toMatchObject({ "devhub/toolset": "integrations" });
    }
    const tasks = await listTools(createDevhubMcpServer(ctx, { ...env, DEVHUB_MCP_TOOLSETS: "tasks" }, plugins).server);
    expect(tasks.some((item) => item.name === "fixture_task")).toBe(true);
    expect(tasks.some((item) => integrationNames.includes(item.name))).toBe(false);
    const integrations = await listTools(createDevhubMcpServer(ctx, { ...env, DEVHUB_MCP_TOOLSETS: "integrations" }, plugins).server);
    expect(integrations.some((item) => item.name === "fixture_task")).toBe(false);
    expect(integrations.filter((item) => integrationNames.includes(item.name)).map((item) => item.name).sort()).toEqual([...integrationNames].sort());
    writeRegistry([{ ...enabled(), enabled: false }]);
    expect(await load()).toEqual([]);
    expect(await listTools(createDevhubMcpServer(ctx, env, plugins).server)).toEqual(off);
  });

  it("rejects extensions of unknown groups before importing code", async () => {
    writeDescriptor([descriptor({ extends: "missing" })]);
    writeRegistry([enabled()]);
    await expectRejected(/Invalid MCP toolset/);
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  it("loads only trusted plugins, preserves metadata, and revokes calls after disable", async () => {
    writeRegistry([enabled()]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "fixture", DEVHUB_MCP_HISTORY: "0" };
    const plugins = await loadPluginToolsets({ home: root, env, reservedToolsets: TOOLSET_NAMES, reservedTools: coreToolNames(ctx) });
    const { server, toolsets } = createDevhubMcpServer(ctx, env, plugins);
    expect(toolsets.names).toEqual(["fixture"]);
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const tools = (await client.listTools()).tools;
      expect(tools).toHaveLength(1);
      expect(tools[0]).toMatchObject({ name: "fixture_read", annotations: { readOnlyHint: true }, _meta: { "devhub/toolset": "fixture" } });
      expect(await client.callTool({ name: "fixture_read", arguments: {} })).toMatchObject({ content: [{ type: "text", text: "ok" }] });
      writeRegistry([{ ...enabled(), enabled: false }]);
      expect(await client.callTool({ name: "fixture_read", arguments: {} })).toMatchObject({ isError: true });
      expect(await loadPluginToolsets({ home: root, env, reservedToolsets: TOOLSET_NAMES, reservedTools: coreToolNames(ctx) })).toEqual([]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("rejects a registrar that claims one name and registers another", async () => {
    writeRegistry([enabled()]);
    writeDescriptor([descriptor({ tools: ["safe_read"] })]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "fixture", DEVHUB_MCP_HISTORY: "0" };
    const plugins = await loadPluginToolsets({ home: root, env, reservedToolsets: TOOLSET_NAMES, reservedTools: coreToolNames(ctx) });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { server, toolsets } = createDevhubMcpServer(ctx, env, plugins);
    expect(toolsets.names).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Unexpected MCP tool"));
    log.mockRestore();
    await server.close();
  });

  it("rolls back a failing registrar without hiding another plugin", async () => {
    const valid = makePlugin("valid", "valid_read");
    fs.writeFileSync(path.join(plugin, "src", "entry.mjs"), `export function register(server) { server.registerTool("fixture_read", {}, async () => ({})); server.registerTool("unlisted", {}, async () => ({})); }\n`);
    writeRegistry([enabled(), enabled(valid.directory, "valid")]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "fixture,valid", DEVHUB_MCP_HISTORY: "0" };
    const plugins = await loadPluginToolsets({ home: root, env, reservedToolsets: TOOLSET_NAMES, reservedTools: coreToolNames(ctx) });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { server, toolsets, availableToolsets } = createDevhubMcpServer(ctx, env, plugins);
    expect(toolsets.names).toEqual(["valid"]);
    expect(availableToolsets).not.toContain("fixture");
    expect((await listTools(server)).map((item) => item.name)).toEqual(["valid_read"]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Unexpected MCP tool"));
    log.mockRestore();
  });

  it("rolls back all selected groups from a broken plugin without hiding other plugins", async () => {
    const valid = makePlugin("valid", "valid_read");
    writeDescriptor([
      descriptor({ name: "task-extension", extends: "tasks" }),
      descriptor({ name: "integration-extension", extends: "integrations", module: "src/integrations.mjs", tools: ["fixture_other"] }),
    ]);
    fs.writeFileSync(path.join(plugin, "src", "integrations.mjs"), 'export function register(server) { server.registerTool("fixture_other", {}, async () => ({})); server.registerTool("unlisted", {}, async () => ({})); }');
    writeRegistry([enabled(), enabled(valid.directory, "valid")]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "tasks,integrations,valid", DEVHUB_MCP_HISTORY: "0" };
    const plugins = await loadPluginToolsets({ home: root, env, reservedToolsets: TOOLSET_NAMES, reservedTools: coreToolNames(ctx) });
    const baseline = await listTools(createDevhubMcpServer(ctx, env).server);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = createDevhubMcpServer(ctx, env, plugins);
    const tools = await listTools(result.server);
    expect(result.toolsets.names).toEqual(["tasks", "integrations", "valid"]);
    expect(tools.filter((item) => item.name !== "valid_read")).toEqual(baseline);
    expect(tools.some((item) => item.name === "valid_read")).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Unexpected MCP tool"));
    log.mockRestore();
  });

  it("does not let a broken plugin replace shared host helpers", async () => {
    const valid = makePlugin("valid", "valid_read");
    fs.writeFileSync(path.join(plugin, "src", "entry.mjs"), 'export function register(server, context, api) { api.withDashboardErrors = null; server.registerTool("fixture_read", {}, async () => ({})); }');
    writeRegistry([enabled(), enabled(valid.directory, "valid")]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "fixture,valid", DEVHUB_MCP_HISTORY: "0" };
    const plugins = await loadPluginToolsets({ home: root, env, reservedToolsets: TOOLSET_NAMES, reservedTools: coreToolNames(ctx) });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = createDevhubMcpServer(ctx, env, plugins);
    expect(result.toolsets.names).toEqual(["valid"]);
    expect((await listTools(result.server)).map((item) => item.name)).toEqual(["valid_read"]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("registration failed"));
    log.mockRestore();
  });

  it("does not let a plugin rename a registered tool into a core tool", async () => {
    fs.writeFileSync(path.join(plugin, "src", "entry.mjs"), `export function register(server) { const tool = server.registerTool("fixture_read", {}, async () => ({})); tool.update({ name: "tasks_list" }); }\n`);
    writeRegistry([enabled()]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "fixture", DEVHUB_MCP_HISTORY: "0" };
    const plugins = await loadPluginToolsets({ home: root, env, reservedToolsets: TOOLSET_NAMES, reservedTools: coreToolNames(ctx) });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { server } = createDevhubMcpServer(ctx, env, plugins);
    expect(await listTools(server)).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("updates are not supported"));
    log.mockRestore();
  });

  it("closes the registration facade before an asynchronous registrar can add a tool", async () => {
    fs.writeFileSync(path.join(plugin, "src", "entry.mjs"), `export async function register(server) { await Promise.resolve(); server.registerTool("fixture_read", {}, async () => ({})); }\n`);
    writeRegistry([enabled()]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "notes,fixture", DEVHUB_MCP_HISTORY: "0" };
    const plugins = await loadPluginToolsets({ home: root, env, reservedToolsets: TOOLSET_NAMES, reservedTools: coreToolNames(ctx) });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { server } = createDevhubMcpServer(ctx, env, plugins);
    await Promise.resolve();
    expect((await listTools(server)).some((item) => item.name === "fixture_read")).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("must register synchronously"));
    log.mockRestore();
  });

  it("does not expose registration methods that bypass declared tool checks", async () => {
    fs.writeFileSync(path.join(plugin, "src", "entry.mjs"), `export function register(server) { server.tool("unlisted", async () => ({})); }\n`);
    writeRegistry([enabled()]);
    const ctx = createContext();
    const env = { DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: "fixture", DEVHUB_MCP_HISTORY: "0" };
    const plugins = await loadPluginToolsets({ home: root, env, reservedToolsets: TOOLSET_NAMES, reservedTools: coreToolNames(ctx) });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { server, toolsets } = createDevhubMcpServer(ctx, env, plugins);
    expect(toolsets.names).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("server.tool is not a function"));
    log.mockRestore();
    await server.close();
  });
});
