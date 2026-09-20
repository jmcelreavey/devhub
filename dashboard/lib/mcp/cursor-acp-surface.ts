import type { Json } from "@/lib/json-file";

/**
 * Cursor ACP (Implement / Plan, Cursor IDE) silently drops MCP tools past a
 * ~190-tool budget. Full DevHub (~177) plus agentmemory / lean-ctx / Playwriter
 * / BI overflows; later servers stay connected (resources list) but their tools
 * never appear — `execute`, `ctx_search`.
 *
 * Claude Code / Codex keep the full catalog. Only Cursor's mcp.json and AionUi's
 * attached `devhub` process get this allowlist.
 */
export const CURSOR_ACP_DEVHUB_TOOLSETS =
  "notes,docs,tasks,plans,status,jobs,work,search,agents,terminal,events,ui,tags,recall,repos,history";

/** Small servers first so a remaining overflow still keeps Playwriter and lean-ctx. */
export const CURSOR_MCP_PRIORITY_SERVERS = [
  "playwriter",
  "lean-ctx",
  "agentmemory",
  "figma",
  "devhub-bi",
] as const;

function asRecord(value: Json | undefined): Record<string, Json> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, Json>;
}

function withEnv(
  entry: Record<string, Json>,
  extra: Record<string, string>,
): Record<string, Json> {
  const env = asRecord(entry.env) ?? {};
  return { ...entry, env: { ...env, ...extra } };
}

/** Force Cursor-ACP env onto a synced mcp.json / AionUi transport entry. Overlay wins. */
export function applyCursorAcpServerOverlay(name: string, entry: Json): Json {
  const rec = asRecord(entry);
  if (!rec) return entry;
  if (name === "devhub") {
    return withEnv(rec, { DEVHUB_MCP_TOOLSETS: CURSOR_ACP_DEVHUB_TOOLSETS });
  }
  if (name === "lean-ctx") {
    return withEnv(rec, { LEAN_CTX_TOOL_PROFILE: "standard" });
  }
  return rec;
}

export function orderCursorMcpServers(
  servers: Record<string, Json>,
): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const name of CURSOR_MCP_PRIORITY_SERVERS) {
    if (Object.prototype.hasOwnProperty.call(servers, name))
      out[name] = servers[name];
  }
  for (const name of Object.keys(servers)) {
    if (!Object.prototype.hasOwnProperty.call(out, name))
      out[name] = servers[name];
  }
  return out;
}
