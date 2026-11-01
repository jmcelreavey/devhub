import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { Context } from "../context.ts";
import { repoClone, repoCloneRemote, repoOpen, repoOpenOptions } from "../../../../packages/shared/actions/repos.ts";
import { registerReposTools } from "./repos.ts";

describe("repos_clone", () => {
  it("keeps arbitrary remote URLs off the MCP surface", async () => {
    expect(repoClone.input.safeParse({ fullName: "owner/repo" }).success).toBe(true);
    expect(repoClone.input.safeParse({ fullName: "https://example.invalid/repo" }).success).toBe(false);
    expect(repoClone.input.safeParse({ url: "https://example.invalid/repo" }).success).toBe(false);
    expect("name" in repoCloneRemote.mcp).toBe(false);
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const server = { registerTool: (name: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => handlers.set(name, handler) } as unknown as McpServer;
    const post = vi.fn().mockResolvedValue({ ok: true, repo: { path: "/fixture/repo" } });
    registerReposTools(server, { dashboard: { post } } as unknown as Context);
    expect(await handlers.get("repos_clone")!({ fullName: "owner/repo" })).toMatchObject({ content: [{ text: "Cloned owner/repo → /fixture/repo." }] });
    expect(post).toHaveBeenCalledWith("/api/repos/clone", { fullName: "owner/repo" }, 120_000);
  });
});

describe("repos_open", () => {
  it("does not expose note, revision or worktree options through MCP", () => {
    expect(Object.keys(repoOpen.input.shape)).toEqual(["name"]);
    expect("name" in repoOpenOptions.mcp).toBe(false);
    expect(repoOpenOptions.input.safeParse({ name: "repo", notePath: "a", filePath: "b" }).success).toBe(false);
  });
});

describe("repos_git_status", () => {
  it("retains formatted status and dashboard error results", async () => {
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const server = { registerTool: (name: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => handlers.set(name, handler) } as unknown as McpServer;
    const get = vi.fn().mockResolvedValue({ currentBranch: "main", upstream: null, files: [], clean: true });
    registerReposTools(server, { dashboard: { get } } as unknown as Context);
    const call = handlers.get("repos_git_status")!;

    expect(await call({ name: "demo" })).toMatchObject({ content: [{ text: "On main (no upstream): clean working tree." }] });
    expect(get).toHaveBeenCalledWith("/api/repos/demo/git/status");
    get.mockRejectedValueOnce(new Error("offline"));
    expect(await call({ name: "demo" })).toMatchObject({ isError: true, content: [{ text: "Unexpected error: offline" }] });
  });
});

describe("repos_git_stage", () => {
  it("does not mutate without confirmation", async () => {
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const server = { registerTool: (name: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => handlers.set(name, handler) } as unknown as McpServer;
    const post = vi.fn().mockResolvedValue({ ok: true });
    registerReposTools(server, { dashboard: { post } } as unknown as Context);
    const call = handlers.get("repos_git_stage")!;

    expect(await call({ name: "demo", action: "stage", paths: ["file.txt"], confirm: false })).toMatchObject({
      content: [{ text: "Dry run — would stage file.txt. Pass confirm:true." }],
    });
    expect(post).not.toHaveBeenCalled();
    await call({ name: "demo", action: "stage", paths: ["file.txt"], confirm: true });
    expect(post).toHaveBeenCalledWith("/api/repos/demo/git/stage", { action: "stage", paths: ["file.txt"] });
  });
});

describe("repos_git_stash", () => {
  it("keeps stash mutations behind confirmation while allowing reads", async () => {
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const server = { registerTool: (name: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => handlers.set(name, handler) } as unknown as McpServer;
    const get = vi.fn().mockResolvedValue({ stashes: [] });
    const post = vi.fn().mockResolvedValue({ ok: true });
    registerReposTools(server, { dashboard: { get, post } } as unknown as Context);
    const call = handlers.get("repos_git_stash")!;

    for (const action of ["save", "apply", "pop", "drop"]) {
      expect(await call({ name: "demo", action, ref: "0" })).toMatchObject({ content: [{ text: `Dry run — would ${action} stash 0. Pass confirm:true.` }] });
    }
    expect(post).not.toHaveBeenCalled();
    await call({ name: "demo", action: "list" });
    expect(get).toHaveBeenCalledWith("/api/repos/demo/git/stash");
    await call({ name: "demo", action: "show", ref: "0" });
    expect(post).toHaveBeenCalledWith("/api/repos/demo/git/stash", { action: "show", ref: "0", message: undefined });
    await call({ name: "demo", action: "drop", ref: "0", confirm: true });
    expect(post).toHaveBeenCalledWith("/api/repos/demo/git/stash", { action: "drop", ref: "0", message: undefined });
  });
});

describe("repos_git_conflicts", () => {
  it("confirms resolution and sends the action required by the dashboard", async () => {
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const server = { registerTool: (name: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => handlers.set(name, handler) } as unknown as McpServer;
    const post = vi.fn().mockResolvedValue({ ok: true });
    registerReposTools(server, { dashboard: { post } } as unknown as Context);
    const call = handlers.get("repos_git_conflicts")!;
    const input = { name: "demo", action: "resolve", path: "file.txt", content: "resolved", expectedContent: "conflict" };

    expect(await call(input)).toMatchObject({ content: [{ text: "Dry run — would resolve file.txt. Pass confirm:true." }] });
    expect(post).not.toHaveBeenCalled();
    await call({ ...input, confirm: true });
    expect(post).toHaveBeenCalledWith("/api/repos/demo/git/conflicts", { action: "resolve", path: "file.txt", content: "resolved", expectedContent: "conflict" });
  });
});

describe("repos_git_discard and repos_git_stage_hunk", () => {
  it("keeps destructive and hunk operations behind confirmation", async () => {
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const server = { registerTool: (name: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => handlers.set(name, handler) } as unknown as McpServer;
    const post = vi.fn().mockResolvedValue({ ok: true });
    registerReposTools(server, { dashboard: { post } } as unknown as Context);
    const discard = handlers.get("repos_git_discard")!;
    const hunk = handlers.get("repos_git_stage_hunk")!;
    const discardInput = { name: "demo", paths: ["file.txt"], scope: "unstaged", confirm: false };
    const hunkInput = { name: "demo", path: "file.txt", action: "stage-hunk", rawDiff: "diff", hunkIndex: 0, confirm: false };

    expect(await discard(discardInput)).toMatchObject({ content: [{ text: "Dry run — would discard unstaged changes in file.txt. Pass confirm:true." }] });
    expect(await hunk(hunkInput)).toMatchObject({ content: [{ text: "Dry run — would stage-hunk hunk 0 on file.txt. Pass confirm:true." }] });
    expect(post).not.toHaveBeenCalled();
    await discard({ ...discardInput, confirm: true });
    expect(post).toHaveBeenCalledWith("/api/repos/demo/git/stage", { action: "discard", paths: ["file.txt"], scope: "unstaged" });
    await hunk({ ...hunkInput, confirm: true });
    expect(post).toHaveBeenCalledWith("/api/repos/demo/git/stage", { action: "stage-hunk", path: "file.txt", rawDiff: "diff", hunkIndex: 0, lineIndexes: undefined });
  });
});

describe("repo branch mutations", () => {
  it("previews branch, commit and push without contacting the dashboard", async () => {
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const server = { registerTool: (name: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => handlers.set(name, handler) } as unknown as McpServer;
    const post = vi.fn().mockResolvedValue({ ok: true });
    registerReposTools(server, { dashboard: { post } } as unknown as Context);
    const branch = handlers.get("repos_git_branch")!;
    const commit = handlers.get("repos_git_commit")!;
    const push = handlers.get("repos_git_push")!;

    expect(await branch({ name: "demo", action: "delete-branch", branch: "old", confirm: false })).toMatchObject({ content: [{ text: "Dry run — would delete-branch old. Pass confirm:true." }] });
    expect(await commit({ name: "demo", message: "fixture commit", confirm: false })).toMatchObject({ content: [{ text: "Dry run — would commit with message: fixture commit" }] });
    expect(await push({ name: "demo", confirm: false })).toMatchObject({ content: [{ text: "Dry run — pass confirm:true to push." }] });
    expect(post).not.toHaveBeenCalled();

    await branch({ name: "demo", action: "fetch", confirm: true });
    expect(post).toHaveBeenCalledWith("/api/repos/demo/branches", { action: "fetch", branch: undefined }, 310_000);
    await commit({ name: "demo", message: "fixture commit", confirm: true });
    expect(post).toHaveBeenCalledWith("/api/repos/demo/branches", { action: "commit", message: "fixture commit", amend: false });
    await push({ name: "demo", confirm: true });
    expect(post).toHaveBeenCalledWith("/api/repos/demo/branches", { action: "push" }, 310_000);
  });
});

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

describe("repos_git_blame", () => {
  it("preserves the line-scoped history query and client-side range", async () => {
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const server = { registerTool: (name: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => handlers.set(name, handler) } as unknown as McpServer;
    const get = vi.fn().mockResolvedValue({ lines: [], history: [] });
    registerReposTools(server, { dashboard: { get } } as unknown as Context);

    await handlers.get("repos_git_blame")!({ name: "demo", path: "file.txt", line: 4, startLine: 2, endLine: 6 });
    expect(get).toHaveBeenCalledWith("/api/repos/demo/git/blame", { path: "file.txt", line: 4 }, 60_000);
  });
});

describe("repos_git_diff", () => {
  it("preserves the staged query and formatted output", async () => {
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const server = { registerTool: (name: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => handlers.set(name, handler) } as unknown as McpServer;
    const get = vi.fn().mockResolvedValue({ raw: "", empty: true });
    registerReposTools(server, { dashboard: { get } } as unknown as Context);

    expect(await handlers.get("repos_git_diff")!({ name: "demo", path: "file.txt", staged: true, context: 5 })).toMatchObject({ content: [{ text: "No changes in file.txt." }] });
    expect(get).toHaveBeenCalledWith("/api/repos/demo/git/diff", { path: "file.txt", staged: "1", context: 5 });
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
