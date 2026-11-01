import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pluginContext } from "../../../apps/core/src/lib/plugins/context";
import { confirmOperation, prepareLocal, startLifecycle } from "../../../apps/core/src/lib/plugins/operations";
import { loadRuntime } from "../../../apps/core/src/lib/plugins/runtime-host";
import { prepareRuntimeToolset as prepareHostAdapter } from "../../../apps/core/src/lib/plugins/runtime-toolsets";
import { globalRegistry } from "zod/v4";
import { createContext } from "./context.ts";
import { loadPluginToolsets } from "./plugin-toolsets.ts";
import { createDevhubMcpServer } from "./server.ts";
import { execExternal } from "../../../apps/core/src/lib/exec-external";
import template from "../../../templates/runtime-plugin/devhub-plugin.json";

let root: string;
let source: string;
let env: NodeJS.ProcessEnv;
const metadata = {
  name: "fixture_write", description: "Reviewed fixture write",
  execution: { taskSupport: "forbidden" },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    type: "object", properties: { title: { type: "string", description: "Kept title" }, status: { type: "string", enum: ["open", "closed"] }, references: { type: "array", items: { type: "string" }, minItems: 1 } },
    required: ["title"], additionalProperties: false, $schema: "http://json-schema.org/draft-07/schema#",
  },
};
const options = () => ({ home: root, env, reservedToolsets: ["notes"], reservedTools: new Set(["notes_read"]) });
const ctx = () => pluginContext({ home: root, env });

async function install() {
  const review = await prepareLocal(ctx(), source, { reviewRuntimeReplacement: true });
  if (!review.preview?.canApply) throw new Error(JSON.stringify(review));
  expect((await confirmOperation(ctx(), review.id, { accepted: true, revision: review.preview.revision, planDigest: review.preview.planDigest, selectedTargets: [] })).state).toBe("succeeded");
}

beforeEach(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "runtime-toolsets-")));
  source = path.join(root, "source");
  fs.mkdirSync(source);
  env = { NODE_ENV: "test", DEVHUB_CONFIG_DIR: path.join(root, "config"), DEVHUB_PLUGIN_HOME: path.join(root, "managed"), DEVHUB_PLUGIN_TARGET_HOME: path.join(root, "targets"), DEVHUB_MCP_TOOLSETS: "fixture", DEVHUB_MCP_HISTORY: "0" };
  for (const key of ["NOTES_DIR", "TASKS_DIR", "DOCS_DIR"]) vi.stubEnv(key, path.join(root, key));
  vi.stubEnv("DEVHUB_MCP_HISTORY", "0");
  fs.copyFileSync(fileURLToPath(new URL("../../../templates/runtime-plugin/package-lock.json", import.meta.url)), path.join(source, "package-lock.json"));
  const worker = `import fs from 'node:fs';
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
const request=JSON.parse(Buffer.concat(chunks).toString());
fs.appendFileSync('calls',request.body.method+'\\n');
let result;
if(request.body.method==='tools/list')result={tools:[${JSON.stringify(metadata)}]};
else {
  const input=request.body.params.arguments;
  if(typeof input.title!=='string'||input.references?.length===0)result={content:[{type:'text',text:'Invalid arguments'}],isError:true};
  else {fs.writeFileSync('state',JSON.stringify(input));result={content:[{type:'text',text:input.title}]};}
}
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:1,result}));`;
  fs.writeFileSync(path.join(source, "worker.mjs"), worker);
  const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(path.join(source, file))).digest("hex");
  fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify({ ...template, name: "fixture", runtime: {
    ...template.runtime, pages: [], routes: [], mcp: [{ name: "fixture", description: "Fixture" }],
    sha256: hash("worker.mjs"), lockfile: { path: "package-lock.json", sha256: hash("package-lock.json") },
    permissions: { env: [], network: [], exec: false },
  } }));
  fs.writeFileSync(path.join(source, "devhub-mcp-toolsets.json"), JSON.stringify({ version: 2, toolsets: [{ name: "fixture", runtime: "fixture", tools: ["fixture_write"] }] }));
  // This source module must never execute, even though it ships in the snapshot.
  fs.writeFileSync(path.join(source, "registrar.mjs"), `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(path.join(root, "imported"))},'unsafe');`);
  await install();
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

it("keeps tool metadata and headless writes in reviewed workers, with no source import", async () => {
  const plugins = await loadPluginToolsets(options());
  expect(plugins).toHaveLength(1);
  const { server, toolsets } = createDevhubMcpServer(createContext(), env, plugins);
  expect(toolsets.names).toEqual(["fixture"]);
  const client = new Client({ name: "test", version: "1" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tools = (await client.listTools()).tools;
    expect(tools).toHaveLength(1);
    const { _meta, ...actual } = tools[0];
    expect(_meta?.["devhub/toolset"]).toBe("fixture");
    expect(actual).toEqual(metadata);
    expect((await client.callTool({ name: "fixture_write", arguments: { title: "Retained", status: "open" } })).content).toEqual([{ type: "text", text: "Retained" }]);
    const data = path.join(env.DEVHUB_PLUGIN_HOME!, "runtime-data", loadRuntime(ctx(), "fixture").id);
    expect(JSON.parse(fs.readFileSync(path.join(data, "state"), "utf8"))).toEqual({ title: "Retained", status: "open" });
    expect((await client.callTool({ name: "fixture_write", arguments: { status: "open" } })).isError).toBe(true);
    expect((await client.callTool({ name: "fixture_write", arguments: { title: "Blocked", references: [] } })).isError).toBe(true);
    expect(fs.readFileSync(path.join(data, "calls"), "utf8")).toBe("tools/list\ntools/call\ntools/call\ntools/call\n");
    expect(JSON.parse(fs.readFileSync(path.join(data, "state"), "utf8"))).toEqual({ title: "Retained", status: "open" });
    const disable = await startLifecycle(ctx(), "fixture", "disable");
    if (!disable.preview) throw new Error("Missing disable preview");
    await confirmOperation(ctx(), disable.id, { accepted: true, revision: disable.preview.revision, planDigest: disable.preview.planDigest, selectedTargets: [] });
    expect((await client.callTool({ name: "fixture_write", arguments: { title: "Blocked" } })).isError).toBe(true);
    expect(fs.readFileSync(path.join(data, "calls"), "utf8")).toBe("tools/list\ntools/call\ntools/call\ntools/call\n");
    expect(fs.existsSync(path.join(root, "imported"))).toBe(false);
  } finally { await client.close(); await server.close(); }
});

it("routes approval-bearing MCP calls to the dashboard at the reviewed revision", async () => {
  const manifestPath = path.join(source, "devhub-plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.runtime.capabilities = { approvals: [{ server: "fixture", tool: "fixture_write" }] };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  await install();
  const loaded = loadRuntime(ctx(), "fixture");
  const hostRequest = vi.fn(async () => ({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "Pending host approval" }] } }));
  const prepared = await prepareHostAdapter({ home: root, env, plugin: "fixture", root: loaded.root, server: "fixture", tools: ["fixture_write"], selected: true, schemaRegistry: globalRegistry, hostRequest });
  let call: ((input: Record<string, unknown>, extra: { signal: AbortSignal }) => Promise<unknown>) | undefined;
  if (!("register" in prepared) || !prepared.register) throw new Error("Missing registrar");
  prepared.register({ registerTool: (_name, _config, callback) => { call = callback; } });
  const signal = new AbortController().signal;
  expect(await call!({ title: "Fixture" }, { signal })).toEqual({ content: [{ type: "text", text: "Pending host approval" }] });
  expect(hostRequest).toHaveBeenCalledWith(expect.objectContaining({ method: "tools/call" }), loaded.revision, signal);
  expect(fs.existsSync(path.join(env.DEVHUB_PLUGIN_HOME!, "runtime-data", loaded.id, "state"))).toBe(false);
});

it("honours off and unselected toolsets without launching the worker", async () => {
  for (const selection of ["off", "notes"]) {
    env.DEVHUB_MCP_TOOLSETS = selection;
    const plugins = await loadPluginToolsets(options());
    expect(plugins).toHaveLength(1);
    expect(plugins[0].register).toBeUndefined();
  }
  expect(fs.existsSync(path.join(env.DEVHUB_PLUGIN_HOME!, "runtime-data", loadRuntime(ctx(), "fixture").id, "calls"))).toBe(false);
});

it("loads reviewed tools through the real stdio peer from outside the dashboard directory", async () => {
  const { stdout } = await execExternal(process.execPath, [fileURLToPath(new URL("../scripts/call-tool.mjs", import.meta.url)), "--list"], {
    cwd: root, timeoutMs: 15000, maxBuffer: 256 * 1024,
    env: { ...env, HOME: root, PATH: process.env.PATH, REPO_ROOT: root, NOTES_DIR: path.join(root, "notes"), DOCS_DIR: path.join(root, "docs"), TASKS_DIR: path.join(root, "tasks") },
  });
  expect(stdout.trim()).toBe("fixture_write");
  expect(fs.existsSync(path.join(root, "imported"))).toBe(false);
});

it("rejects namespace collisions before starting a runtime worker", async () => {
  for (const reserved of [{ reservedToolsets: ["fixture"], reservedTools: new Set<string>() }, { reservedToolsets: ["notes"], reservedTools: new Set(["fixture_write"]) }]) {
    const errors: string[] = [];
    expect(await loadPluginToolsets({ ...options(), ...reserved, onError: message => errors.push(message) })).toEqual([]);
    expect(errors.join(" ")).toMatch(/collision/);
  }
  expect(fs.existsSync(path.join(env.DEVHUB_PLUGIN_HOME!, "runtime-data", loadRuntime(ctx(), "fixture").id, "calls"))).toBe(false);
});

it("retires an existing proxy after replacement without replaying a write", async () => {
  const [previous] = await loadPluginToolsets(options());
  fs.writeFileSync(path.join(source, "release.txt"), "reviewed new snapshot\n");
  await install();
  expect(previous.isEnabled()).toBe(false);
  expect((await loadPluginToolsets(options()))[0].isEnabled()).toBe(true);
});

it.each(["inventory", "server", "source", "consent"])("fails closed for a changed %s declaration", async reason => {
  if (reason === "consent") {
    const file = path.join(loadRuntime(ctx(), "fixture").root, "worker.mjs");
    fs.appendFileSync(file, "\n// unreviewed edit\n");
  } else {
    const descriptor = { version: 2, toolsets: [{ name: "fixture", runtime: reason === "server" ? "unknown" : "fixture", tools: [reason === "inventory" ? "unexpected_tool" : "fixture_write"] }] };
    fs.writeFileSync(path.join(source, "devhub-mcp-toolsets.json"), JSON.stringify(descriptor));
    if (reason === "source") {
      fs.writeFileSync(path.join(source, "devhub-mcp-toolsets.json"), JSON.stringify({ version: 2, toolsets: [{ name: "fixture", module: "registrar.mjs", runtime: "fixture", tools: ["fixture_write"] }] }));
    }
    await install();
  }
  const errors: string[] = [];
  expect(await loadPluginToolsets({ ...options(), onError: message => errors.push(message) })).toEqual([]);
  expect(errors).toHaveLength(1);
  expect(fs.existsSync(path.join(root, "imported"))).toBe(false);
});
