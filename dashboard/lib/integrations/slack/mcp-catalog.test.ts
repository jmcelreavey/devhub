import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMcpClientSession, groupByCategory, mcpChildEnv, SlackToolCatalog, toSlackTool, type McpToolSession } from "./mcp-catalog";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "slack-catalog-")); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); vi.useRealTimers(); });

const raw = (name: string, extra: Record<string, unknown> = {}) => ({ name, description: `Does ${name}`, inputSchema: { type: "object", properties: {} }, ...extra });
function session(tools: unknown[]): McpToolSession & { listTools: ReturnType<typeof vi.fn>; callTool: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } {
  return { listTools: vi.fn(async () => tools), callTool: vi.fn(async () => ({ text: "ok", isError: false })), close: vi.fn(async () => {}) };
}

describe("toSlackTool", () => {
  it("closes a connection during a stalled handshake without waiting for it to finish", async () => {
    let started!: () => void;
    const starting = new Promise<void>((resolve) => { started = resolve; });
    const transport: Transport = { start: async () => { started(); await new Promise<void>(() => {}); }, send: vi.fn(async () => {}), close: vi.fn(async () => { transport.onclose?.(); }) };
    const connection = createMcpClientSession(() => transport);
    void connection.listTools();
    await starting;
    await connection.close();
    expect(transport.close).toHaveBeenCalledOnce();
    await expect(connection.listTools()).rejects.toThrow("closed");
  });
  it("reads hints, defaulting a non-read-only tool to destructive as MCP does", () => {
    expect(toSlackTool(raw("notes_list", { annotations: { readOnlyHint: true } }))).toMatchObject({ readOnly: true, destructive: false });
    expect(toSlackTool(raw("notes_write", { annotations: { readOnlyHint: false, destructiveHint: false } }))).toMatchObject({ readOnly: false, destructive: false });
    expect(toSlackTool(raw("notes_delete", { annotations: { readOnlyHint: false, destructiveHint: true } }))).toMatchObject({ readOnly: false, destructive: true });
    // Annotated but silent about destructiveness: MCP's default is destructive.
    expect(toSlackTool(raw("mystery", { annotations: { readOnlyHint: false } }))).toMatchObject({ readOnly: false, destructive: true });
    // No hints at all (a plugin tool): never read-only, so it always asks, but it isn't called destructive on a guess.
    expect(toSlackTool(raw("mystery"))).toMatchObject({ readOnly: false, destructive: false, unrated: true });
    expect(toSlackTool(raw("mystery", { annotations: {} }))).toMatchObject({ readOnly: false, destructive: false, unrated: true });
  });
  it("uses the server's toolset tag, else the name prefix", () => {
    expect(toSlackTool(raw("repos_git_log", { _meta: { "devhub/toolset": "repos" } }))?.category).toBe("repos");
    expect(toSlackTool(raw("repos_git_log"))?.category).toBe("repos");
  });
  it("drops malformed entries and keeps descriptions short", () => {
    expect(toSlackTool({ nope: true })).toBeNull();
    expect(toSlackTool(raw("a", { description: "x".repeat(2000) }))!.description.length).toBe(400);
  });
});

describe("SlackToolCatalog", () => {
  it("loads more than 255 tools from the MCP session and groups them", async () => {
    const many = Array.from({ length: 300 }, (_, i) => raw(`g${i % 30}_t${i}`, { annotations: { readOnlyHint: i % 2 === 0 } }));
    const mcp = session(many);
    const catalog = new SlackToolCatalog({ createSession: () => mcp, cacheFile: path.join(root, "tools.json") });
    const tools = await catalog.tools("work");
    expect(tools).toHaveLength(300);
    expect(groupByCategory(tools).size).toBe(30);
  });
  it("caches in memory and on disk, and refreshes on demand", async () => {
    const mcp = session([raw("a_one"), raw("b_two")]);
    const file = path.join(root, "tools.json");
    const catalog = new SlackToolCatalog({ createSession: () => mcp, cacheFile: file });
    await catalog.tools("work");
    await catalog.tools("work");
    expect(mcp.listTools).toHaveBeenCalledTimes(1);
    const fresh = new SlackToolCatalog({ createSession: () => mcp, cacheFile: file });
    await fresh.tools("work");
    expect(mcp.listTools).toHaveBeenCalledTimes(1);
    await fresh.tools("work", true);
    expect(mcp.listTools).toHaveBeenCalledTimes(2);
  });
  it("reloads after the cache goes stale", async () => {
    let now = 0;
    const mcp = session([raw("a_one")]);
    const catalog = new SlackToolCatalog({ createSession: () => mcp, cacheFile: path.join(root, "tools.json"), now: () => now, ttlMs: 1000 });
    await catalog.tools("work");
    now = 2000;
    await catalog.tools("work");
    expect(mcp.listTools).toHaveBeenCalledTimes(2);
  });
  it("fails clearly on an empty list rather than caching nothing", async () => {
    const catalog = new SlackToolCatalog({ createSession: () => session([]), cacheFile: path.join(root, "tools.json") });
    await expect(catalog.tools("work")).rejects.toThrow("empty");
  });
  it("calls through one session per profile and closes idle sessions", async () => {
    vi.useFakeTimers();
    const made: string[] = [];
    const mcp = session([raw("a_one")]);
    const catalog = new SlackToolCatalog({ createSession: (profile) => { made.push(profile); return mcp; }, cacheFile: path.join(root, "tools.json"), idleMs: 1000 });
    await catalog.call("work", "a_one", { x: 1 });
    await catalog.call("work", "a_one", {});
    await catalog.call("personal", "a_one", {});
    expect(made).toEqual(["work", "personal"]);
    expect(mcp.callTool).toHaveBeenCalledWith("a_one", { x: 1 }, undefined);
    await vi.advanceTimersByTimeAsync(1500);
    expect(mcp.close).toHaveBeenCalledTimes(2);
    await catalog.call("work", "a_one", {});
    expect(made).toEqual(["work", "personal", "work"]);
    await catalog.close();
  });
  it("does not close an in-flight request when its idle interval elapses", async () => {
    vi.useFakeTimers();
    let finish: ((value: { text: string; isError: boolean }) => void) | undefined;
    const mcp = session([raw("a_one")]);
    mcp.callTool.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const catalog = new SlackToolCatalog({ createSession: () => mcp, cacheFile: path.join(root, "tools.json"), idleMs: 1000 });
    const pending = catalog.call("work", "a_one", {});
    await vi.advanceTimersByTimeAsync(1500);
    expect(mcp.close).not.toHaveBeenCalled();
    finish!({ text: "ok", isError: false });
    await pending;
    await vi.advanceTimersByTimeAsync(1000);
    expect(mcp.close).toHaveBeenCalledTimes(1);
    await catalog.close();
  });
  it("evicts a failed connection without retrying the uncertain call", async () => {
    const first = session([raw("a_one")]);
    first.callTool.mockRejectedValueOnce(new Error("Connection lost"));
    const next = session([raw("a_one")]);
    const createSession = vi.fn().mockReturnValueOnce(first).mockReturnValue(next);
    const catalog = new SlackToolCatalog({ createSession, cacheFile: path.join(root, "tools.json") });
    await expect(catalog.call("work", "a_one", {})).rejects.toThrow("Connection lost");
    expect(first.callTool).toHaveBeenCalledTimes(1);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(next.callTool).not.toHaveBeenCalled();
    await catalog.call("work", "a_one", {});
    expect(next.callTool).toHaveBeenCalledTimes(1);
    await catalog.close();
  });
});

describe("mcpChildEnv", () => {
  const dashboardEnv: Record<string, string> = {
    PATH: "/usr/bin", HOME: "/Users/me", USER: "me", SHELL: "/bin/zsh", LANG: "en_GB.UTF-8", LC_ALL: "en_GB.UTF-8", TMPDIR: "/tmp/x", NODE_EXTRA_CA_CERTS: "/ca.pem", XDG_CONFIG_HOME: "/Users/me/.config",
    SLACK_BOT_TOKEN: "xoxb-private", SLACK_APP_TOKEN: "xapp-private", TYPESAFE_API_KEY: "ts-private", JIRA_API_TOKEN: "jira-private", NODE_AUTH_TOKEN: "npm-private",
    DEVHUB_API_SECRET: "api-private", GITHUB_TOKEN: "gh-private", AWS_SECRET_ACCESS_KEY: "aws-private", AI_API_KEY: "ai-private", OPENAI_API_KEY: "oa-private", DEVHUB_AGENT_RUN_ID: "r1", PORT: "1337", DATABASE_URL: "postgres://u:p@h/db",
  };
  it("passes a shell baseline and the explicit DevHub settings, and nothing secret", () => {
    const env = mcpChildEnv(dashboardEnv, { REPO_ROOT: "/repo", NOTES_DIR: "/notes", DEVHUB_BASE_URL: "http://localhost:1337", DEVHUB_PROFILE: "work" });
    expect(env).toEqual({
      PATH: "/usr/bin", HOME: "/Users/me", USER: "me", SHELL: "/bin/zsh", LANG: "en_GB.UTF-8", LC_ALL: "en_GB.UTF-8", TMPDIR: "/tmp/x", NODE_EXTRA_CA_CERTS: "/ca.pem", XDG_CONFIG_HOME: "/Users/me/.config",
      REPO_ROOT: "/repo", NOTES_DIR: "/notes", DEVHUB_BASE_URL: "http://localhost:1337", DEVHUB_PROFILE: "work",
    });
    expect(JSON.stringify(env)).not.toMatch(/private|xoxb|xapp/);
  });
  it("lets the explicit settings win and keeps the profile per connection", () => {
    expect(mcpChildEnv({ HOME: "/h", DEVHUB_PROFILE: "stale" }, { DEVHUB_PROFILE: "personal" })).toEqual({ HOME: "/h", DEVHUB_PROFILE: "personal" });
  });
});

describe("Slack-side tool ratings at load", () => {
  it("rates datadog_investigate and agent/job/script starters as writes whatever MCP says", () => {
    expect(toSlackTool(raw("datadog_investigate", { annotations: { readOnlyHint: true } }))).toMatchObject({ readOnly: false });
    expect(toSlackTool(raw("jobs_create", { annotations: { readOnlyHint: false, destructiveHint: false } }))).toMatchObject({ readOnly: false, destructive: true });
    expect(toSlackTool(raw("calendar_list", { annotations: { readOnlyHint: true } }))).toMatchObject({ readOnly: true });
  });
});
