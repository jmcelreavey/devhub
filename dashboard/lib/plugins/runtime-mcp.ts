import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { pluginContext } from "./context";
import { runtimeCatalog } from "./runtime-host";
import { hostIsLoopback } from "./management-auth";

function token(name: string, server: string): string | null {
  const secret = process.env.DEVHUB_BOOTSTRAP_TOKEN || process.env.DEVHUB_API_SECRET;
  return secret ? crypto.createHmac("sha256", secret).update(`runtime-mcp:${name}:${server}`).digest("hex") : null;
}

export function runtimeMcpAuthenticated(req: NextRequest, name: string, server: string): boolean {
  const expected = token(name, server);
  const actual = req.headers.get("x-devhub-plugin-token");
  return hostIsLoopback(req) && Boolean(expected && actual && /^[a-f0-9]{64}$/.test(actual) && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected)));
}

/** These HTTP connections launch scoped workers in DevHub, never in the agent's environment. */
export function runtimeMcpServers(): Record<string, { type: "http"; url: string; headers: Record<string, string> }> {
  const origin = `http://127.0.0.1:${Number(process.env.PORT) || 1337}`;
  const result: ReturnType<typeof runtimeMcpServers> = {};
  for (const plugin of runtimeCatalog(pluginContext())) {
    for (const server of plugin.runtime.mcp) {
      const key = token(plugin.name, server.name);
      result[`plugin-${plugin.name}-${server.name}`] = {
        type: "http", url: `${origin}/api/plugins/runtime/${plugin.name}/mcp/${server.name}`,
        headers: { Origin: origin, ...(key ? { "x-devhub-plugin-token": key } : {}) },
      };
    }
  }
  return result;
}
