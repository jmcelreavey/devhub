import { AionClient } from "@/lib/aionui/client";
import { currentAionSession, type AionSession } from "@/lib/aionui/session";
import { applyCursorAcpServerOverlay } from "@/lib/mcp/cursor-acp-surface";
import type { SharedMcpServer } from "@/lib/sync/mcp";

const MANAGED = "[DevHub managed]";

function transport(server: SharedMcpServer): Record<string, unknown> {
  if (server.url) return {
    type: server.type === "sse" ? "sse" : "http", url: server.url,
    ...(server.headers ? { headers: server.headers } : {}),
  };
  return { type: "stdio", command: server.command, ...(server.args ? { args: server.args } : {}), ...(server.env ? { env: server.env } : {}) };
}

function withAcpOverlay(name: string, server: SharedMcpServer): SharedMcpServer {
  const overlay = applyCursorAcpServerOverlay(name, {
    ...(server.command ? { command: server.command } : {}),
    ...(server.args ? { args: server.args } : {}),
    ...(server.env ? { env: server.env } : {}),
    ...(server.url ? { url: server.url } : {}),
  });
  if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) return server;
  const env = overlay.env;
  if (!env || typeof env !== "object" || Array.isArray(env)) return server;
  return { ...server, env: env as Record<string, string> };
}

function payload(name: string, server: SharedMcpServer): Record<string, unknown> {
  const value = transport(withAcpOverlay(name, server));
  return {
    name, description: `${MANAGED}${server.description ? ` ${server.description}` : ""}`,
    transport: value, original_json: JSON.stringify({ mcpServers: { [name]: value } }), builtin: false,
  };
}

/** Turn on every DevHub-managed MCP entry so Agents can call notes/tasks/PRs. */
export async function ensureAionMcpEnabled(
  session: AionSession,
  emit: (line: string) => void = () => undefined,
): Promise<number> {
  const client = new AionClient(session);
  const existing = await client.listMcpServers();
  let enabled = 0;
  for (const item of existing) {
    if (item.builtin) continue;
    if (!item.description?.startsWith(MANAGED)) continue;
    if (item.enabled) { enabled += 1; continue; }
    const next = await client.toggleMcpServer(item.id);
    if (next.enabled !== false) {
      enabled += 1;
      emit(`  ENABLED: ${item.name}`);
    }
  }
  return enabled;
}

export async function syncAionMcpServers(
  servers: Map<string, SharedMcpServer>,
  options: { prune?: boolean; dryRun?: boolean; emit: (line: string) => void },
): Promise<void> {
  const { emit } = options;
  if (options.dryRun) {
    emit(`[aionui] WOULD SYNC: ${servers.size} MCP server(s)`);
    return;
  }
  let client: AionClient;
  let session;
  try {
    session = await currentAionSession();
    client = new AionClient(session);
  } catch { emit("[aionui] SKIP: managed workspace is not connected"); return; }
  const existing = await client.listMcpServers();
  const byName = new Map(existing.map(item => [item.name, item]));
  const creates: Array<Record<string, unknown>> = [];
  for (const [name, server] of servers) {
    const current = byName.get(name);
    if (current?.builtin) { emit(`  SKIP (AionUi built-in): ${name}`); continue; }
    if (current) await client.updateMcpServer(current.id, payload(name, server));
    else creates.push(payload(name, server));
  }
  if (creates.length) await client.importMcpServers(creates);
  if (options.prune) {
    for (const item of existing) {
      if (item.description?.startsWith(MANAGED) && !servers.has(item.name)) await client.deleteMcpServer(item.id);
    }
  }
  const on = await ensureAionMcpEnabled(session, emit);
  emit(`[aionui] SYNCED: ${servers.size} MCP server(s); ${on} enabled`);
}
