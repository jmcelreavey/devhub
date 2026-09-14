/**
 * DevHub MCP call history — the file format, and how to read and summarise it.
 *
 * `~/.local/state/devhub/mcp-history/YYYY-MM-DD.jsonl`, one line per tool call,
 * one file per local day. The MCP server writes it (mcp-servers/devhub-server
 * src/history.ts); the dashboard's Activity page and standup read it. Shared so
 * both sides agree on paths, redaction and what counts as an "action".
 *
 * Arguments are redacted and clipped before they reach disk. Results are never
 * stored — only their size and, for failures, the first line of the error.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface McpHistoryEntry {
  /** Call start, epoch ms. */
  ts: number;
  tool: string;
  toolset: string | null;
  args: unknown;
  durationMs: number;
  ok: boolean;
  error?: string;
  resultChars: number;
  /** MCP client that made the call, e.g. "claude-code 2.1.0". */
  client?: string;
  /** Set when the caller is a DevHub-dispatched agent run. */
  agentRunId?: string;
  pid: number;
  cwd: string;
}

export interface McpHistoryFilter {
  /** Exact tool name, or a prefix ending in `*`. */
  tool?: string;
  errorsOnly?: boolean;
  agentRunId?: string;
  /** Case-insensitive substring of the client label. */
  client?: string;
}

export interface McpHistorySummary {
  date: string;
  total: number;
  failed: number;
  firstTs: number | null;
  lastTs: number | null;
  clients: Array<{ client: string; count: number }>;
  toolsets: Array<{ toolset: string; count: number }>;
  tools: Array<{ tool: string; count: number; failed: number; totalMs: number }>;
  actions: Array<{ ts: number; tool: string; ok: boolean; detail: string }>;
  errors: Array<{ ts: number; tool: string; error: string }>;
  agentRunIds: string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_STRING = 300;
const MAX_ARGS_JSON = 2_000;
const MAX_WINDOW_DAYS = 31;
const REDACTED = "‹redacted›";
const SECRET_KEY_RE = /(token|secret|password|passphrase|api[-_]?key|authorization|cookie|credential)/i;
const SECRET_VALUE_RE = /^(gh[pousr]_|github_pat_|xox[baprs]-|sk-|ey[A-Za-z0-9_-]{10,})/;
/** `scheme://user:pass@host` — keep the host, drop the credentials. */
const URI_USERINFO_RE = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;

export function historyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DEVHUB_MCP_HISTORY !== "0";
}

export function mcpHistoryDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.DEVHUB_MCP_HISTORY_DIR?.trim() || path.join(os.homedir(), ".local", "state", "devhub", "mcp-history");
}

export function isHistoryDate(value: string): boolean {
  return DATE_RE.test(value);
}

/** Local calendar day, so "today" is the user's today rather than UTC's. */
export function localDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function clipText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Redact secret-looking keys and values, clip long strings, cap depth and fan-out. */
export function redactArgs(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    if (SECRET_VALUE_RE.test(value)) return REDACTED;
    return clipText(value.replace(URI_USERINFO_RE, `$1${REDACTED}@`), MAX_STRING);
  }
  if (Array.isArray(value)) {
    if (depth > 4) return "[…]";
    return value.slice(0, 20).map((item) => redactArgs(item, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    if (depth > 4) return "{…}";
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SECRET_KEY_RE.test(key) ? REDACTED : redactArgs(item, depth + 1);
    }
    return out;
  }
  return value;
}

/** Redacted args, replaced by a clipped JSON string when still too large. */
export function summarizeArgs(args: unknown): unknown {
  if (args === undefined || args === null) return null;
  const redacted = redactArgs(args);
  const json = JSON.stringify(redacted);
  return json.length > MAX_ARGS_JSON ? { _truncated: clipText(json, MAX_ARGS_JSON) } : redacted;
}

/** Delete day files older than `keepDays`. `0` keeps everything. */
export function pruneMcpHistory(dir: string, keepDays: number, now = Date.now()): number {
  if (keepDays <= 0) return 0;
  const cutoff = localDate(now - keepDays * 24 * 60 * 60 * 1_000);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    const date = name.replace(/\.jsonl$/, "");
    if (!name.endsWith(".jsonl") || !isHistoryDate(date) || date >= cutoff) continue;
    try {
      fs.unlinkSync(path.join(dir, name));
      removed += 1;
    } catch {
      /* someone else pruned it */
    }
  }
  return removed;
}

function toolMatches(pattern: string, tool: string): boolean {
  return pattern.endsWith("*") ? tool.startsWith(pattern.slice(0, -1)) : tool === pattern;
}

/** One day's entries, oldest first. A corrupt line costs one row, not the day. */
export function readMcpHistory(dir: string, date: string, filter: McpHistoryFilter = {}): McpHistoryEntry[] {
  if (!isHistoryDate(date)) return [];
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(dir, `${date}.jsonl`), "utf8");
  } catch {
    return [];
  }
  const entries: McpHistoryEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry: McpHistoryEntry;
    try {
      entry = JSON.parse(line) as McpHistoryEntry;
    } catch {
      continue;
    }
    if (typeof entry.tool !== "string" || typeof entry.ts !== "number") continue;
    if (filter.tool && !toolMatches(filter.tool, entry.tool)) continue;
    if (filter.errorsOnly && entry.ok) continue;
    if (filter.agentRunId && entry.agentRunId !== filter.agentRunId) continue;
    if (filter.client && !entry.client?.toLowerCase().includes(filter.client.toLowerCase())) continue;
    entries.push(entry);
  }
  return entries.sort((a, b) => a.ts - b.ts);
}

/** Entries with `sinceMs <= ts < untilMs`, across every local day the window touches (max 31). */
export function readMcpHistoryWindow(
  dir: string,
  sinceMs: number,
  untilMs: number,
  filter: McpHistoryFilter = {},
): McpHistoryEntry[] {
  if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs) || untilMs <= sinceMs) return [];
  const out: McpHistoryEntry[] = [];
  const day = new Date(sinceMs);
  day.setHours(0, 0, 0, 0);
  for (let i = 0; i < MAX_WINDOW_DAYS && day.getTime() < untilMs; i++) {
    for (const entry of readMcpHistory(dir, localDate(day.getTime()), filter)) {
      if (entry.ts >= sinceMs && entry.ts < untilMs) out.push(entry);
    }
    day.setDate(day.getDate() + 1);
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/** Tools that change something (or start something) — the lines worth reading in a recap. */
const ACTION_RE =
  /(^|_)(create|write|append|update|delete|rename|record|set|commit|push|stage|discard|stash|branch|clone|run|restart|transition|execute|publish|one_time|revoke|dispatch|race|followup|cancel|remember|apply|ship|propose|investigate|complete|learn|connect)($|_)/;

/** Argument keys that identify what an action touched, most specific first. */
const DETAIL_KEYS = ["path", "title", "name", "repo", "provider", "runId", "script", "command", "id", "key", "message", "query"];

export function isActionTool(tool: string): boolean {
  return ACTION_RE.test(tool);
}

export function describeArgs(args: unknown): string {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "";
  const record = args as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of DETAIL_KEYS) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") parts.push(`${key}=${clipText(String(value), 80)}`);
    if (parts.length === 2) break;
  }
  return parts.join(" ");
}

function countBy<T>(items: T[], key: (item: T) => string): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts.entries()].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count);
}

export function summarizeMcpHistory(date: string, entries: McpHistoryEntry[]): McpHistorySummary {
  const tools = new Map<string, { tool: string; count: number; failed: number; totalMs: number }>();
  for (const entry of entries) {
    const row = tools.get(entry.tool) ?? { tool: entry.tool, count: 0, failed: 0, totalMs: 0 };
    row.count += 1;
    row.totalMs += entry.durationMs;
    if (!entry.ok) row.failed += 1;
    tools.set(entry.tool, row);
  }
  return {
    date,
    total: entries.length,
    failed: entries.filter((e) => !e.ok).length,
    firstTs: entries[0]?.ts ?? null,
    lastTs: entries[entries.length - 1]?.ts ?? null,
    clients: countBy(entries, (e) => e.client ?? "unknown").map(({ key, count }) => ({ client: key, count })),
    toolsets: countBy(entries, (e) => e.toolset ?? "other").map(({ key, count }) => ({ toolset: key, count })),
    tools: [...tools.values()].sort((a, b) => b.count - a.count),
    actions: entries
      .filter((e) => isActionTool(e.tool))
      .map((e) => ({ ts: e.ts, tool: e.tool, ok: e.ok, detail: describeArgs(e.args) })),
    errors: entries.filter((e) => !e.ok).map((e) => ({ ts: e.ts, tool: e.tool, error: e.error ?? "failed" })),
    agentRunIds: [...new Set(entries.map((e) => e.agentRunId).filter((id): id is string => Boolean(id)))],
  };
}
