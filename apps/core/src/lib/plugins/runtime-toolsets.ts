import { z } from "zod";
import { pluginContext } from "./context";
import { invokeRuntime, loadRuntime } from "./runtime-host";
import { runtimeResponse } from "./runtime-response";

const tool = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
  title: z.string().optional(), description: z.string().optional(),
  execution: z.object({ taskSupport: z.literal("forbidden") }).strict().optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
  inputSchema: z.object({ type: z.literal("object") }).catchall(z.unknown()),
  annotations: z.object({
    title: z.string().optional(), readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(), idempotentHint: z.boolean().optional(), openWorldHint: z.boolean().optional(),
  }).strict().optional(),
}).strict();
const listing = z.object({ tools: z.array(tool).max(256) }).strict();
const result = z.object({ content: z.array(z.unknown()), isError: z.boolean().optional() }).passthrough();
interface ToolServer {
  registerTool: (name: string, config: Record<string, unknown>, callback: (input: Record<string, unknown>, extra: { signal: AbortSignal }) => Promise<unknown>) => unknown;
}

/** Trusted core adapter; plugin code only runs in the existing restricted worker. */
export async function prepareRuntimeToolset(options: {
  home: string; env: NodeJS.ProcessEnv; plugin: string; root: string; server: string; tools: string[]; selected: boolean;
  schemaRegistry: Pick<typeof z.globalRegistry, "add">;
  hostRequest?: (body: unknown, revision: string, signal?: AbortSignal) => Promise<unknown>;
}) {
  const ctx = pluginContext({ home: options.home, env: options.env });
  const plugin = loadRuntime(ctx, options.plugin);
  if (plugin.root !== options.root || !plugin.runtime.mcp.some(server => server.name === options.server)) {
    throw new Error("The runtime MCP server is not reviewed.");
  }
  const isEnabled = () => {
    try {
      const current = loadRuntime(ctx, options.plugin);
      return current.root === plugin.root && current.revision === plugin.revision;
    } catch { return false; }
  };
  const call = async (method: string, params?: unknown, signal?: AbortSignal): Promise<unknown> => {
    if (!isEnabled()) throw new Error("The runtime plugin changed or is disabled.");
    const body = { jsonrpc: "2.0", id: 1, method, ...(params === undefined ? {} : { params }) };
    const name = method === "tools/call" && params && typeof params === "object" ? (params as { name?: unknown }).name : undefined;
    const needsHost = typeof name === "string" && [plugin.runtime.capabilities?.approvals, plugin.runtime.capabilities?.agentRuns, plugin.runtime.capabilities?.terminalProposals, plugin.runtime.capabilities?.settings]
      .some(grants => grants?.some(grant => "server" in grant && grant.server === options.server && grant.tool === name));
    if (needsHost && !options.hostRequest) throw new Error("The dashboard is required for this reviewed action.");
    const output = needsHost ? await options.hostRequest!(body, plugin.revision, signal) : await invokeRuntime(ctx, plugin.name, {
      kind: "mcp", path: options.server, method: "POST", body,
    }, signal, undefined, plugin.root, plugin.revision);
    if (!isEnabled()) throw new Error("The runtime plugin changed or is disabled.");
    const response = runtimeResponse(z.object({ jsonrpc: z.literal("2.0"), id: z.literal(1), result: z.unknown() }).strict(), output, plugin, ctx);
    return response.result;
  };
  if (!options.selected) return { isEnabled };
  const tools = runtimeResponse(listing, await call("tools/list"), plugin, ctx).tools;
  if (tools.length !== options.tools.length || new Set(tools.map(tool => tool.name)).size !== tools.length ||
      tools.some(tool => !options.tools.includes(tool.name))) throw new Error("The runtime tool inventory does not match its reviewed descriptor.");
  const registrations = tools.map(({ inputSchema, ...metadata }) => {
    if (Object.keys(inputSchema).every(key => ["type", "properties"].includes(key)) &&
        inputSchema.properties && typeof inputSchema.properties === "object" && !Object.keys(inputSchema.properties).length) {
      return { ...metadata, inputSchema: undefined };
    }
    // Validation belongs to the worker's original registrar; forward arguments unchanged.
    const schema = z.object({}).passthrough();
    options.schemaRegistry.add(schema, inputSchema);
    return { ...metadata, inputSchema: schema };
  });
  return {
    isEnabled,
    register(server: ToolServer) {
      for (const { name, ...config } of registrations) {
        server.registerTool(name, config, async (input, extra) => runtimeResponse(result,
          await call("tools/call", { name, arguments: config.inputSchema ? input : {} },
            config.inputSchema ? extra.signal : input.signal as AbortSignal), plugin, ctx));
      }
    },
  };
}
