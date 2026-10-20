import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import { writeAtomic } from "@/lib/atomic-write";
import { getDocsDir, getNotesDir, getTasksDir } from "@/lib/content/dirs";
import { buildRuntimeInfo } from "@/lib/dashboard-runtime";
import { getCheckoutRoot } from "@/lib/desktop/runtime-paths";
import { mcpHttpEntry } from "@/lib/mcp-http-peer";
import { augmentedPathEnv, scrubDesktopRuntimeEnv } from "@/lib/process-env";
import { slackStateRoot } from "./store";
import { applySlackToolRisk } from "./tool-risk";

/** The toolset a tool was registered under (server.ts adds it); older servers fall back to the name prefix. */
export const TOOLSET_META_KEY = "devhub/toolset";
/** Which plugin a tool came from (the plugin session adds it). */
export const PLUGIN_META_KEY = "devhub/plugin";

export interface SlackTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  /** MCP's default: a write is destructive unless the tool says it is not. */
  destructive: boolean;
  category: string;
  /** The plugin that contributed the tool; absent for DevHub's own tools. */
  plugin?: string;
  server?: string;
  originalName?: string;
  /** The tool carries no read-only or destructive hint at all, so Slack can't tell what it does and always asks first. */
  unrated?: boolean;
}

export interface McpCallResult { text: string; isError: boolean; structuredContent?: Record<string, unknown> }

/** What the catalog needs from an MCP connection; the SDK client implements it in production. */
export interface McpToolSession {
  listTools: () => Promise<readonly unknown[]>;
  callTool: (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<McpCallResult>;
  close: () => Promise<void>;
}
export type McpSessionFactory = (profile: string) => McpToolSession;

const RawToolSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()).default({ type: "object" }),
  annotations: z.object({ readOnlyHint: z.boolean().optional(), destructiveHint: z.boolean().optional() }).passthrough().optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
});

export function toSlackTool(raw: unknown): SlackTool | null {
  const parsed = RawToolSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { name, description, inputSchema, annotations, _meta } = parsed.data;
  const readOnly = annotations?.readOnlyHint === true && annotations?.destructiveHint !== true;
  // No hint either way (typical of a plugin tool): not read-only, so it always asks, but it isn't called destructive on a guess.
  const unrated = annotations?.readOnlyHint === undefined && annotations?.destructiveHint === undefined;
  const toolset = _meta?.[TOOLSET_META_KEY];
  const plugin = _meta?.[PLUGIN_META_KEY];
  return applySlackToolRisk({
    name, description: (description ?? "").replace(/\s+/g, " ").trim().slice(0, 400), inputSchema,
    readOnly, destructive: !readOnly && !unrated && annotations?.destructiveHint !== false,
    category: typeof toolset === "string" && toolset ? toolset : name.split("_")[0],
    ...(typeof plugin === "string" && plugin ? { plugin } : {}),
    ...(typeof _meta?.["devhub/server"] === "string" ? { server: _meta["devhub/server"] } : {}),
    ...(typeof _meta?.["devhub/originalName"] === "string" ? { originalName: _meta["devhub/originalName"] } : {}),
    ...(unrated ? { unrated } : {}),
  });
}

export function groupByCategory(tools: readonly SlackTool[]): Map<string, SlackTool[]> {
  const groups = new Map<string, SlackTool[]>();
  for (const tool of tools) groups.set(tool.category, [...groups.get(tool.category) ?? [], tool]);
  return groups;
}

const CacheSchema = z.object({ at: z.number(), tools: z.array(z.unknown()), signature: z.string().optional() });
const CACHE_TTL_MS = 60 * 60 * 1000;
const IDLE_CLOSE_MS = 3 * 60 * 1000;
const CALL_TIMEOUT_MS = 60_000;

export interface CatalogOptions {
  createSession: McpSessionFactory;
  cacheFile?: string;
  now?: () => number;
  ttlMs?: number;
  idleMs?: number;
  /**
   * A fingerprint of whatever else feeds the tool list (the enabled plugins). When it changes, the cached
   * list is dropped at once instead of waiting for the TTL, so installing or removing a plugin shows up
   * on the next question. Absent or empty means nothing besides DevHub's own tools.
   */
  signature?: () => string;
}

interface CatalogSession { session: McpToolSession; active: number; signature?: string; timer?: ReturnType<typeof setTimeout>; queue: Promise<unknown> }

/** The DevHub MCP tool list, cached in memory and on disk, plus a per-profile connection for calling tools. */
export class SlackToolCatalog {
  private loaded = new Map<string, { at: number; tools: SlackTool[]; signature: string }>();
  private sessions = new Map<string, CatalogSession>();
  private readonly cacheFile: string;
  private readonly now: () => number;

  constructor(private readonly options: CatalogOptions) {
    this.cacheFile = options.cacheFile ?? path.join(slackStateRoot(), "tools.json");
    this.now = options.now ?? Date.now;
  }

  async tools(profile: string, refresh = false): Promise<SlackTool[]> {
    const signature = this.options.signature?.() ?? "";
    const ttl = this.options.ttlMs ?? (signature ? 60_000 : CACHE_TTL_MS);
    if (!refresh) {
      const loaded = this.loaded.get(profile);
      if (loaded && loaded.signature === signature && this.now() - loaded.at < ttl) return loaded.tools;
      const cached = this.readCache(profile);
      if (cached && cached.signature === signature && this.now() - cached.at < ttl) { this.loaded.set(profile, cached); return cached.tools; }
    }
    const raw = await this.useSession(profile, (entry) => this.discover(profile, entry, signature));
    const tools = raw.flatMap((item) => { const tool = toSlackTool(item); return tool ? [tool] : []; });
    if (!tools.length) throw new Error("The DevHub tool list is empty");
    this.loaded.set(profile, { at: this.now(), tools, signature });
    await this.writeCache(profile, raw, signature).catch(() => { console.warn("[slack] Could not cache the tool list."); });
    return tools;
  }

  async call(profile: string, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult> {
    return this.useSession(profile, async (entry) => {
      const signature = this.options.signature?.() ?? "";
      if (entry.signature !== signature) {
        const previous = this.loaded.get(profile);
        const raw = await this.discover(profile, entry, signature);
        const tools = raw.flatMap((item) => { const tool = toSlackTool(item); return tool ? [tool] : []; });
        this.loaded.set(profile, { at: this.now(), tools, signature });
        if (previous && previous.signature !== signature) throw new Error("The plugin catalog changed. Ask again so its permissions can be checked.");
      }
      return entry.session.callTool(name, args, signal);
    });
  }

  private async discover(profile: string, entry: CatalogSession, signature: string): Promise<readonly unknown[]> {
    if (entry.signature !== undefined && entry.signature !== signature) {
      await entry.session.close();
      entry.session = this.options.createSession(profile);
    }
    const raw = await entry.session.listTools();
    if ((this.options.signature?.() ?? "") !== signature) throw new Error("The plugin catalog changed during discovery. Ask again.");
    entry.signature = signature;
    return raw;
  }

  async close(): Promise<void> {
    const open = [...this.sessions.values()];
    this.sessions.clear();
    for (const entry of open) clearTimeout(entry.timer);
    await Promise.all(open.map((entry) => entry.session.close()));
  }

  /** One connection per profile (each server process is scoped to its profile), closed when idle. */
  private async useSession<Result>(profile: string, work: (entry: CatalogSession) => Promise<Result>): Promise<Result> {
    let entry = this.sessions.get(profile);
    if (!entry) {
      const created = this.options.createSession(profile);
      entry = { session: created, active: 0, queue: Promise.resolve() };
      this.sessions.set(profile, entry);
    }
    const current = entry;
    clearTimeout(current.timer);
    current.active++;
    const result = current.queue.then(() => work(current));
    current.queue = result.catch(() => undefined);
    try { return await result; }
    catch (error) {
      if (this.sessions.get(profile) === current) this.sessions.delete(profile);
      await current.session.close().catch(() => { console.warn("[slack] Could not close a failed tool connection."); });
      throw error;
    } finally {
      current.active--;
      if (current.active === 0 && this.sessions.get(profile) === current) {
        current.timer = setTimeout(() => {
          this.sessions.delete(profile);
          void current.session.close().catch(() => { console.warn("[slack] Could not close an idle tool connection."); });
        }, this.options.idleMs ?? IDLE_CLOSE_MS);
        current.timer.unref?.();
      }
    }
  }

  private profileCacheFile(profile: string): string {
    return `${this.cacheFile}.${createHash("sha256").update(profile).digest("hex").slice(0, 16)}`;
  }

  private readCache(profile: string): { at: number; tools: SlackTool[]; signature: string } | null {
    try {
      const parsed = CacheSchema.parse(JSON.parse(fs.readFileSync(this.profileCacheFile(profile), "utf8")));
      const tools = parsed.tools.flatMap((item) => { const tool = toSlackTool(item); return tool ? [tool] : []; });
      return tools.length ? { at: parsed.at, tools, signature: parsed.signature ?? "" } : null;
    } catch { return null; }
  }

  private async writeCache(profile: string, raw: readonly unknown[], signature: string): Promise<void> {
    fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true, mode: 0o700 });
    await writeAtomic(this.profileCacheFile(profile), JSON.stringify({ at: this.now(), tools: raw, signature }));
  }
}

/** What the DevHub MCP server needs from its environment: a shell-ish baseline, never a credential. */
const CHILD_ENV_ALLOWED = /^(?:PATH|HOME|USER|LOGNAME|SHELL|LANG|LANGUAGE|TZ|TMPDIR|TEMP|TMP|TERM|LC_[A-Z_]+|NODE_[A-Z_]+|XDG_[A-Z_]+)$/;
/** Never passed on, even when an allowed prefix matches (NODE_AUTH_TOKEN, SLACK_BOT_TOKEN, …). */
const CHILD_ENV_SECRET = /(?:^SLACK_|TOKEN|SECRET|KEY|PASSWORD|PASSWD|CREDENTIAL|^AWS_|^GITHUB_|^GH_)/i;

/**
 * The environment for the MCP child: an allowlisted baseline from the dashboard's own environment
 * plus the explicit DevHub settings the server reads. The server reaches the dashboard over HTTP
 * and holds no tokens, so none of the dashboard's secrets (Slack, Jira, TypeSafe, …) are inherited.
 */
export function mcpChildEnv(source: Readonly<Record<string, string | undefined>>, explicit: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && CHILD_ENV_ALLOWED.test(name) && !CHILD_ENV_SECRET.test(name)) env[name] = value;
  }
  for (const [name, value] of Object.entries(explicit)) if (value !== undefined) env[name] = value;
  return env;
}

/**
 * An MCP client connection that opens its transport on first use and closes cleanly. Both the DevHub
 * server and plugin servers use it; only how the transport is made differs.
 */
export function createMcpClientSession(makeTransport: () => Transport): McpToolSession {
  let client: Client | undefined;
  let disconnect: (() => Promise<void>) | undefined;
  let connecting: Promise<Client> | undefined;
  let closed = false;
  const connect = async (): Promise<Client> => {
    if (closed) throw new Error("The Slack tool connection is closed");
    if (client) return client;
    if (connecting) return connecting;
    const transport = makeTransport();
    const next = new Client({ name: "devhub-slack", version: "1.0.0" });
    let closing: Promise<void> | undefined;
    const disconnectNext = () => closing ??= next.close();
    disconnect = disconnectNext;
    connecting = (async () => {
      try {
        await next.connect(transport);
        if (closed) throw new Error("The Slack tool connection is closed");
        return (client = next);
      } catch (error) {
        await disconnectNext().catch(() => { console.warn("[slack] Could not close a failed tool connection."); });
        throw error;
      } finally { connecting = undefined; }
    })();
    return connecting;
  };
  return {
    async listTools() {
      const tools: unknown[] = [];
      let cursor: string | undefined;
      do {
        const page = await (await connect()).listTools(cursor ? { cursor } : undefined);
        tools.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor);
      return tools;
    },
    async callTool(name, args, signal) {
      const result = await (await connect()).callTool({ name, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS, signal });
      const content = Array.isArray(result.content) ? result.content : [];
      const text = content.map((part) => (part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : "")).filter(Boolean).join("\n");
      return { text, isError: result.isError === true, ...(result.structuredContent && typeof result.structuredContent === "object" && !Array.isArray(result.structuredContent) ? { structuredContent: result.structuredContent as Record<string, unknown> } : {}) };
    },
    async close() {
      closed = true;
      client = undefined;
      await disconnect?.();
    },
  };
}

/**
 * Talks to the same stdio server agents use, from the linked checkout (the MCP server is not
 * bundled in the desktop app, so this is the path in both dev and the installed app).
 */
export function createStdioMcpSession(profile: string): McpToolSession {
  return createMcpClientSession(() => {
    const checkout = getCheckoutRoot();
    if (!checkout) throw new Error("No linked DevHub checkout, so the DevHub tools are not available");
    const target = mcpHttpEntry(checkout);
    if (!target) throw new Error("The DevHub MCP server is not installed (run npm install in mcp-servers/devhub-server)");
    return new StdioClientTransport({
      command: target.tsx, args: [path.join(target.cwd, "src", "mcp.ts")], cwd: target.cwd, stderr: "ignore",
      env: mcpChildEnv(scrubDesktopRuntimeEnv(augmentedPathEnv()), {
        REPO_ROOT: checkout, NOTES_DIR: getNotesDir(), TASKS_DIR: getTasksDir(), DOCS_DIR: getDocsDir(),
        DEVHUB_BASE_URL: buildRuntimeInfo().baseUrl, DEVHUB_PROFILE: profile,
      }),
    });
  });
}
