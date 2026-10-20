import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { Context } from "../context.ts";
import { registerReposTools } from "./repos.ts";

describe("repos_git_worktrees cleanup", () => {
  function setup(response: unknown = { removed: ["/repo/tree"], errors: [] }) {
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const server = { registerTool: (name: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => handlers.set(name, handler) } as unknown as McpServer;
    const get = vi.fn().mockResolvedValue({ worktrees: [], mergedCleanupSupported: true });
    const post = vi.fn().mockResolvedValue(response);
    registerReposTools(server, { dashboard: { get, post } } as unknown as Context);
    return { call: handlers.get("repos_git_worktrees")!, get, post };
  }
  const entries = [{ path: "/repo/tree", head: "a".repeat(40) }];
  it("returns the detailed cleanup preview", async () => {
    const { call, get, post } = setup();
    await call({ name: "demo", action: "review" });
    expect(get).toHaveBeenCalledWith("/api/repos/demo/worktrees", { details: "1" }, 180_000);
    expect(post).not.toHaveBeenCalled();
  });
  it("does not delete without confirmation and reviewed HEADs", async () => {
    const { call, post } = setup();
    expect(await call({ name: "demo", action: "cleanup", entries })).toMatchObject({ isError: true });
    expect(await call({ name: "demo", action: "cleanup", confirm: true })).toMatchObject({ isError: true });
    expect(post).not.toHaveBeenCalled();
  });
  it("requires verified merges and leaves ignored files protected by default", async () => {
    const { call, post } = setup();
    await call({ name: "demo", action: "cleanup", entries, confirm: true, force: true });
    expect(post).toHaveBeenCalledWith("/api/repos/demo/worktrees",
      { entries, confirmed: true, mergedOnly: true, includeIgnored: false }, 300_000);
  });
  it("refuses cleanup against an older packaged dashboard", async () => {
    const { call, get, post } = setup();
    get.mockResolvedValue({ worktrees: [] });
    expect(await call({ name: "demo", action: "cleanup", entries, confirm: true })).toMatchObject({ isError: true });
    expect(post).not.toHaveBeenCalled();
  });
  it("reports partial failures without hiding removed paths", async () => {
    const response = { removed: ["/repo/tree"], errors: [{ path: "/repo/dirty", error: "Local changes" }] };
    const { call } = setup(response);
    expect(await call({ name: "demo", action: "cleanup", entries, confirm: true })).toMatchObject({
      isError: true, content: [{ type: "text", text: JSON.stringify(response) }],
    });
  });
});

describe("repos_git_show", () => {
  it("maps the tool ref argument to the dashboard commit parameter", async () => {
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const server = {
      registerTool: (
        name: string,
        _config: unknown,
        handler: (args: Record<string, unknown>) => Promise<unknown>,
      ) => {
        handlers.set(name, handler);
      },
    } as unknown as McpServer;
    const get = vi.fn().mockResolvedValue({ hash: "abc123" });
    const context = { dashboard: { get } } as unknown as Context;
    registerReposTools(server, context);

    await handlers.get("repos_git_show")?.({ name: "demo", ref: "HEAD~1", path: "README.md" });

    expect(get).toHaveBeenCalledWith("/api/repos/demo/git/show", {
      commit: "HEAD~1",
      path: "README.md",
    });
  });
});

describe("repos_git_log", () => {
  it("forwards the pagination offset", async () => {
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const server = {
      registerTool: (
        name: string,
        _config: unknown,
        handler: (args: Record<string, unknown>) => Promise<unknown>,
      ) => handlers.set(name, handler),
    } as unknown as McpServer;
    const get = vi.fn().mockResolvedValue({ commits: [] });
    registerReposTools(server, { dashboard: { get } } as unknown as Context);

    await handlers.get("repos_git_log")?.({ name: "demo", limit: 25, offset: 50 });

    expect(get).toHaveBeenCalledWith("/api/repos/demo/git/log", { limit: 25, offset: 50 });
  });
});

describe("repos_worktree_cleanup", () => {
  function setup() {
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const server = { registerTool: (name: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => handlers.set(name, handler) } as unknown as McpServer;
    const get = vi.fn().mockResolvedValue({ rows: [{ repo: "app", path: "/r/app-wt1", branch: "x", reason: "run-finished" }, { repo: "app", path: "/r/app-wt2", branch: "y", reason: "pr-merged" }], kept: 0, failedRepos: [] });
    const post = vi.fn().mockResolvedValue({ ok: true, removed: ["/r/app-wt1"], skipped: [{ repo: "app", path: "/r/app-wt2", reason: "it has uncommitted changes" }] });
    registerReposTools(server, { dashboard: { get, post } } as unknown as Context);
    return { call: handlers.get("repos_worktree_cleanup")!, get, post };
  }
  const items = [{ repo: "app", path: "/r/app-wt1" }];

  it("lists finished worktrees across repos", async () => {
    const { call, get, post } = setup();
    await call({});
    expect(get).toHaveBeenCalledWith("/api/repos/worktree-cleanup", undefined, 180_000);
    expect(post).not.toHaveBeenCalled();
  });

  it("refuses a bulk delete without confirm:true, but allows a dry run", async () => {
    const { call, post } = setup();
    expect(await call({ action: "remove", items })).toMatchObject({ isError: true });
    expect(await call({ action: "remove" })).toMatchObject({ isError: true });
    expect(post).not.toHaveBeenCalled();
    await call({ action: "remove", items, dryRun: true });
    expect(post).toHaveBeenCalledWith("/api/repos/worktree-cleanup", { items, dryRun: true }, 300_000);
  });

  it("deletes all listed worktrees in one call and reports the skipped ones with reasons", async () => {
    const { call, post } = setup();
    const result = (await call({ action: "remove", all: true, confirm: true })) as { content: { text: string }[] };
    expect(post).toHaveBeenCalledWith("/api/repos/worktree-cleanup", { items: [{ repo: "app", path: "/r/app-wt1" }, { repo: "app", path: "/r/app-wt2" }] }, 300_000);
    expect(result.content[0].text).toContain("uncommitted changes");
    // Never forced: the tool has no force option to pass through.
    expect(JSON.stringify(post.mock.calls)).not.toContain("force");
  });
});
