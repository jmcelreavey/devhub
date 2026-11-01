import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import type { PluginToolset } from "./plugin-toolsets.ts";
import { globalRegistry } from "zod/v4";
import { DashboardClient } from "./dashboard-client.ts";
import { resolveDashboard } from "./discover-dashboard.ts";

interface RuntimeToolsetOptions {
  home: string; env: NodeJS.ProcessEnv; plugin: string; root: string; server: string; tools: string[]; selected: boolean;
  schemaRegistry?: unknown;
  hostRequest?: (body: unknown, revision: string, signal?: AbortSignal) => Promise<unknown>;
}
type Prepare = (options: RuntimeToolsetOptions) => Promise<Pick<PluginToolset, "register" | "isEnabled">>;
let prepare: Promise<Prepare> | undefined;

/** Load our own adapter with the dashboard aliases, never a plugin module. Works without HTTP. */
export async function prepareRuntimeToolset(options: RuntimeToolsetOptions) {
  prepare ??= (async () => {
    const core = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const namespace = "devhub-runtime-core";
    const tsconfig = path.join(core, "apps/ui/tsconfig.json");
    const cjs = await import("tsx/cjs/api");
    // The CJS API captures this synchronously and has no tsconfig option.
    const previous = process.env.TSX_TSCONFIG_PATH;
    let imported: unknown;
    try {
      process.env.TSX_TSCONFIG_PATH = tsconfig;
      const loader = cjs.register({ namespace });
      imported = loader.require(path.join(core, "apps/core/src/lib/plugins/runtime-toolsets.ts"), import.meta.url);
    } finally {
      if (previous === undefined) delete process.env.TSX_TSCONFIG_PATH;
      else process.env.TSX_TSCONFIG_PATH = previous;
    }
    const exports = imported as { prepareRuntimeToolset?: Prepare; default?: { prepareRuntimeToolset?: Prepare } };
    const adapter = exports.prepareRuntimeToolset ?? exports.default?.prepareRuntimeToolset;
    if (typeof adapter !== "function") throw new Error("The runtime MCP adapter is unavailable.");
    return adapter;
  })();
  const dashboard = new DashboardClient(() => resolveDashboard(options.env).baseUrl);
  const secret = options.env.DEVHUB_BOOTSTRAP_TOKEN || options.env.DEVHUB_API_SECRET;
  const token = secret ? crypto.createHmac("sha256", secret).update(`runtime-mcp:${options.plugin}:${options.server}`).digest("hex") : undefined;
  const hostRequest = (body: unknown, revision: string, signal?: AbortSignal) => dashboard.request(`/api/plugins/runtime/${encodeURIComponent(options.plugin)}/mcp/${encodeURIComponent(options.server)}`, {
    method: "POST", body, signal, timeoutMs: 660000, headers: { "x-devhub-plugin-revision": revision, ...(token ? { "x-devhub-plugin-token": token } : {}) },
  });
  return (await prepare)({ ...options, schemaRegistry: globalRegistry, hostRequest });
}
