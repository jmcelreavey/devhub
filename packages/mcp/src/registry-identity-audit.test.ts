import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listEnabledPlugins } from "../../../apps/core/src/lib/plugins/registry";
import { createContext } from "./context.ts";
import { createConfiguredDevhubMcpServer } from "./server.ts";

interface Fixture {
  directory: string;
  marker: string;
  tool: string;
}

type DescriptorMode = "valid" | "none" | "malformed";

let root: string;
let config: string;
let sessions: Array<{ client: Client; server: McpServer }>;

function fixture(label: string, name: string, mode: DescriptorMode = "valid"): Fixture {
  const directory = path.join(root, label);
  const marker = path.join(root, label + "-imported");
  const tool = label + "_tool";
  fs.mkdirSync(path.join(directory, "src"), { recursive: true });
  fs.writeFileSync(path.join(directory, "devhub-plugin.json"), JSON.stringify({ name, version: "1", devhubApi: "1", contributes: {} }));
  if (mode !== "none") {
    const descriptor = mode === "malformed" ? "{" : JSON.stringify({ version: 1, toolsets: [{ name: label + "-group", module: "src/entry.mjs", export: "register", tools: [tool] }] });
    fs.writeFileSync(path.join(directory, "devhub-mcp-toolsets.json"), descriptor);
    fs.writeFileSync(path.join(directory, "src", "entry.mjs"), 'import fs from "node:fs"; fs.writeFileSync(' + JSON.stringify(marker) + ', "imported"); export function register(server) { server.registerTool(' + JSON.stringify(tool) + ', { description: "Fixture" }, async () => ({ content: [{ type: "text", text: ' + JSON.stringify(label) + ' }] })); }');
  }
  return { directory, marker, tool };
}

function entry(plugin: Fixture, name?: string, enabled: unknown = true): Record<string, unknown> {
  return { path: plugin.directory, ...(name === undefined ? {} : { name }), ...(enabled === undefined ? {} : { enabled }) };
}

function registry(entries: unknown[]): void {
  fs.writeFileSync(path.join(config, "plugins.json"), JSON.stringify({ plugins: entries }));
}

async function open(selection = "first-group,second-group,independent-group") {
  const context = createContext();
  const env = { NODE_ENV: "test" as const, DEVHUB_CONFIG_DIR: config, DEVHUB_MCP_TOOLSETS: selection, DEVHUB_MCP_HISTORY: "0" };
  const { server } = await createConfiguredDevhubMcpServer(context, env);
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "identity-regression", version: "1" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  sessions.push({ client, server });
  return client;
}

async function toolNames(client: Client): Promise<string[]> {
  return (await client.listTools()).tools.map((tool) => tool.name).sort();
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-identity-regression-"));
  config = path.join(root, ".config", "devhub");
  fs.mkdirSync(config, { recursive: true });
  sessions = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("REPO_ROOT", root);
  vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
  vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
  vi.stubEnv("DOCS_DIR", path.join(root, "docs"));
  vi.stubEnv("DEVHUB_MCP_HISTORY", "0");
});

afterEach(async () => {
  for (const session of sessions) {
    await session.client.close();
    await session.server.close();
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("MCP registry identity and dashboard first-valid selection", () => {
  it.each([
    ["unnamed descriptor-free then named", undefined, "dup", "none", true],
    ["named descriptor-free then unnamed", "dup", undefined, "none", true],
    ["two unnamed entries", undefined, undefined, "valid", true],
    ["unnamed malformed descriptor", undefined, "dup", "malformed", true],
    ["implicit-enabled unnamed entry", undefined, "dup", "none", "implicit"],
    ["implicit-enabled named entry", "dup", "dup", "none", "implicit"],
    ["non-boolean enabled unnamed entry", undefined, "dup", "none", "not-boolean"],
    ["padded registry name", " dup ", "dup", "none", true],
  ] as const)("fails closed for %s without blocking an unrelated plugin", async (_label, firstName, secondName, mode, enabled) => {
    const first = fixture("first", "dup", mode);
    const second = fixture("second", "dup");
    const independent = fixture("independent", "independent");
    const firstEntry = entry(first, firstName);
    if (enabled === "implicit") delete firstEntry.enabled;
    else firstEntry.enabled = enabled;
    registry([firstEntry, entry(second, secondName), entry(independent, "independent")]);
    expect(listEnabledPlugins(root).map((plugin) => [plugin.name, plugin.path])).toEqual([["dup", first.directory], ["independent", independent.directory]]);
    const client = await open();
    expect(await toolNames(client)).toEqual(["independent_tool"]);
    expect(fs.existsSync(first.marker)).toBe(false);
    expect(fs.existsSync(second.marker)).toBe(false);
    expect(fs.existsSync(independent.marker)).toBe(true);
  });

  it("ignores an explicitly disabled duplicate but does not execute an implicit-only entry", async () => {
    const first = fixture("first", "dup", "none");
    const second = fixture("second", "dup");
    const independent = fixture("independent", "independent");
    registry([entry(first, undefined, false), entry(second, "dup"), entry(independent, "independent")]);
    expect(listEnabledPlugins(root).find((plugin) => plugin.name === "dup")?.path).toBe(second.directory);
    const client = await open();
    expect(await toolNames(client)).toEqual(["independent_tool", "second_tool"]);
    const implicit = entry(second, "dup");
    delete implicit.enabled;
    registry([implicit, entry(independent, "independent")]);
    expect(listEnabledPlugins(root).find((plugin) => plugin.name === "dup")?.path).toBe(second.directory);
    expect(await client.callTool({ name: second.tool, arguments: {} })).toMatchObject({ isError: true });
    expect(await toolNames(await open())).toEqual(["independent_tool"]);
  });

  it("treats a missing named duplicate as a claim and ignores unrelated missing paths", async () => {
    const second = fixture("second", "dup");
    const independent = fixture("independent", "independent");
    registry([{ name: "dup", path: path.join(root, "missing"), enabled: true }, { path: path.join(root, "unrelated-missing"), enabled: true }, entry(second, "dup"), entry(independent, "independent")]);
    expect(listEnabledPlugins(root).find((plugin) => plugin.name === "dup")?.path).toBe(second.directory);
    expect(await toolNames(await open())).toEqual(["independent_tool"]);
    expect(fs.existsSync(second.marker)).toBe(false);
  });

  it("isolates an unreadable unnamed manifest but retains an invalid named claim", async () => {
    const first = fixture("first", "dup", "none");
    const second = fixture("second", "dup");
    const independent = fixture("independent", "independent");
    fs.writeFileSync(path.join(first.directory, "devhub-plugin.json"), "{");
    registry([entry(first), entry(second, "dup"), entry(independent, "independent")]);
    expect(listEnabledPlugins(root).find((plugin) => plugin.name === "dup")?.path).toBe(second.directory);
    expect(await toolNames(await open())).toEqual(["independent_tool", "second_tool"]);
    registry([entry(first, "dup"), entry(second, "dup"), entry(independent, "independent")]);
    expect(await toolNames(await open())).toEqual(["independent_tool"]);
  });

  it("conservatively blocks a parsed unnamed identity even when its manifest is dashboard-invalid", async () => {
    const first = fixture("first", "dup", "none");
    const second = fixture("second", "dup");
    const independent = fixture("independent", "independent");
    fs.writeFileSync(path.join(first.directory, "devhub-plugin.json"), JSON.stringify({ name: "dup", version: "1", devhubApi: "1", contributes: { unknown: "bad" } }));
    registry([entry(first), entry(second, "dup"), entry(independent, "independent")]);
    expect(listEnabledPlugins(root).find((plugin) => plugin.name === "dup")?.path).toBe(second.directory);
    expect(await toolNames(await open())).toEqual(["independent_tool"]);
    expect(fs.existsSync(second.marker)).toBe(false);
  });

  it("revokes an advertised tool when a descriptor-free duplicate appears, without revoking another plugin", async () => {
    const first = fixture("first", "dup", "none");
    const second = fixture("second", "dup");
    const independent = fixture("independent", "independent");
    registry([entry(second, "dup"), entry(independent, "independent")]);
    const client = await open();
    expect(await client.callTool({ name: second.tool, arguments: {} })).toMatchObject({ content: [{ type: "text", text: "second" }] });
    const implicit = entry(first);
    delete implicit.enabled;
    registry([implicit, entry(second, "dup"), entry(independent, "independent")]);
    expect(listEnabledPlugins(root).find((plugin) => plugin.name === "dup")?.path).toBe(first.directory);
    expect(await client.callTool({ name: second.tool, arguments: {} })).toMatchObject({ isError: true });
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/duplicate enabled plugin: dup/i));
    expect(await client.callTool({ name: independent.tool, arguments: {} })).toMatchObject({ content: [{ type: "text", text: "independent" }] });
    expect(await toolNames(await open())).toEqual(["independent_tool"]);
    registry([entry(first, undefined, false), entry(second, "dup"), entry(independent, "independent")]);
    expect(await client.callTool({ name: second.tool, arguments: {} })).toMatchObject({ content: [{ type: "text", text: "second" }] });
  });

  it("does not publish a plugin when a descriptor-free duplicate appears during import", async () => {
    const first = fixture("first", "dup", "none");
    const second = fixture("second", "dup");
    const independent = fixture("independent", "independent");
    const release = path.join(root, "release");
    const wait = 'await new Promise((resolve, reject) => { const timer = setInterval(() => { if (fs.existsSync(' + JSON.stringify(release) + ')) { clearInterval(timer); clearTimeout(timeout); resolve(); } }, 10); const timeout = setTimeout(() => { clearInterval(timer); reject(new Error("test gate timed out")); }, 5000); });';
    fs.writeFileSync(path.join(second.directory, "src", "entry.mjs"), 'import fs from "node:fs"; fs.writeFileSync(' + JSON.stringify(second.marker) + ', "imported"); ' + wait + ' export function register(server) { server.registerTool("second_tool", { description: "Fixture" }, async () => ({ content: [] })); }');
    registry([entry(second, "dup"), entry(independent, "independent")]);
    const pending = open();
    try {
      await vi.waitFor(() => expect(fs.existsSync(second.marker)).toBe(true), { timeout: 3000, interval: 10 });
      registry([entry(first), entry(second, "dup"), entry(independent, "independent")]);
    } finally {
      fs.writeFileSync(release, "go");
    }
    expect(await toolNames(await pending)).toEqual(["independent_tool"]);
    expect(fs.existsSync(independent.marker)).toBe(true);
  });
  it.each([true, undefined, "not-boolean"])("treats a dashboard-eligible named relative path (%s) as a claim only for that name", async (enabled) => {
    const first = fixture("first", "dup", "none");
    const second = fixture("second", "dup");
    const independent = fixture("independent", "independent");
    const relative = path.relative(process.cwd(), first.directory);
    registry([{ name: "dup", path: relative, enabled }, entry(second, "dup"), entry(independent, "independent")]);
    expect(listEnabledPlugins(root).find((plugin) => plugin.name === "dup")?.path).toBe(first.directory);
    expect(await toolNames(await open())).toEqual(["independent_tool"]);
    expect(fs.existsSync(second.marker)).toBe(false);
  });

  it("revokes plugin tools on an unnamed relative path, while leaving core tools available", async () => {
    const first = fixture("first", "dup", "none");
    const second = fixture("second", "dup");
    const independent = fixture("independent", "independent");
    registry([entry(second, "dup"), entry(independent, "independent")]);
    const client = await open("events,second-group,independent-group");
    expect(await client.callTool({ name: second.tool, arguments: {} })).toMatchObject({ content: [{ type: "text", text: "second" }] });
    const relative = path.relative(process.cwd(), first.directory);
    registry([{ path: relative, enabled: false }, entry(second, "dup"), entry(independent, "independent")]);
    expect(await client.callTool({ name: second.tool, arguments: {} })).toMatchObject({ content: [{ type: "text", text: "second" }] });
    vi.mocked(console.error).mockClear();
    registry([{ path: relative, enabled: true }, entry(second, "dup"), entry(independent, "independent")]);
    expect(listEnabledPlugins(root).find((plugin) => plugin.name === "dup")?.path).toBe(first.directory);
    expect(await client.callTool({ name: second.tool, arguments: {} })).toMatchObject({ isError: true });
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/unnamed.*relative/i));
    expect(await toolNames(client)).toEqual(["events_wait", "independent_tool", "second_tool"]);
    registry([{ path: relative }, entry(second, "dup"), entry(independent, "independent")]);
    expect(await client.callTool({ name: second.tool, arguments: {} })).toMatchObject({ isError: true });
    expect(await client.callTool({ name: independent.tool, arguments: {} })).toMatchObject({ isError: true });
    expect(await toolNames(await open("events,second-group,independent-group"))).toEqual(["events_wait"]);
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/unnamed.*relative/i));
    registry([{ name: "dup", path: relative, enabled: true }, entry(second, "dup"), entry(independent, "independent")]);
    expect(await client.callTool({ name: independent.tool, arguments: {} })).toMatchObject({ content: [{ type: "text", text: "independent" }] });
    expect(await client.callTool({ name: second.tool, arguments: {} })).toMatchObject({ isError: true });
  });

  it("follows a descriptor-free symlink only to reserve its dashboard identity", async () => {
    const first = fixture("first", "dup", "none");
    const second = fixture("second", "dup");
    const independent = fixture("independent", "independent");
    const alias = path.join(root, "first-alias");
    fs.symlinkSync(first.directory, alias, "dir");
    registry([{ path: alias, enabled: true }, entry(second, "dup"), entry(independent, "independent")]);
    expect(listEnabledPlugins(root).find((plugin) => plugin.name === "dup")?.path).toBe(alias);
    expect(await toolNames(await open())).toEqual(["independent_tool"]);
    expect(fs.existsSync(second.marker)).toBe(false);
  });

  it("does not exhaust the identity budget on missing absolute paths", async () => {
    const independent = fixture("independent", "independent");
    const missing = Array.from({ length: 130 }, (_unused, index) => ({ path: path.join(root, "missing-" + index), enabled: true }));
    registry([...missing, entry(independent, "independent")]);
    expect(await toolNames(await open("independent-group"))).toEqual(["independent_tool"]);
  });

  it("fails closed at the identity entry limit without disabling core tools", async () => {
    const independent = fixture("independent", "independent");
    const entries = Array.from({ length: 129 }, (_unused, index) => {
      const directory = path.join(root, "budget-" + index);
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, "devhub-plugin.json"), JSON.stringify({ name: "budget-" + index, version: "1", devhubApi: "1", contributes: {} }));
      return { path: directory, enabled: true };
    });
    registry([...entries, entry(independent, "independent")]);
    expect(await toolNames(await open("events,independent-group"))).toEqual(["events_wait"]);
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/identity entry limit exceeded/i));
    expect(fs.existsSync(independent.marker)).toBe(false);
  });

  it("fails closed at the identity byte limit without disabling core tools", async () => {
    const independent = fixture("independent", "independent");
    const entries = Array.from({ length: 17 }, (_unused, index) => {
      const directory = path.join(root, "budget-" + index);
      const manifest = JSON.stringify({ name: "budget-" + index, version: "1", devhubApi: "1", contributes: {} });
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, "devhub-plugin.json"), manifest + " ".repeat(256 * 1024 - Buffer.byteLength(manifest)));
      return { path: directory, enabled: true };
    });
    registry([...entries, entry(independent, "independent")]);
    expect(await toolNames(await open("events,independent-group"))).toEqual(["events_wait"]);
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/identity byte limit exceeded/i));
    expect(fs.existsSync(independent.marker)).toBe(false);
  });

  it("does not import any entry when plugin toolsets are off", async () => {
    const second = fixture("second", "dup");
    registry([entry(second, "dup")]);
    const client = await open("off");
    expect(client.getServerCapabilities()?.tools).toBeUndefined();
    expect(fs.existsSync(second.marker)).toBe(false);
  });

});
