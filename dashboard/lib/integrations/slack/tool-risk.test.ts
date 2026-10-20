import { describe, expect, it } from "vitest";
import { toSlackTool } from "./mcp-catalog";
import { slackReadOnly, slackToolRisk } from "./tool-risk";

/** A tool as the MCP server annotates it today (annotations.ts), so the overrides are tested against the real ratings. */
const tool = (name: string, hints: { readOnlyHint?: boolean; destructiveHint?: boolean }) => toSlackTool({ name, description: name, inputSchema: { type: "object" }, annotations: hints })!;
const readOnly = { readOnlyHint: true, destructiveHint: false };
const write = { readOnlyHint: false, destructiveHint: false };

describe("worktree cleanup", () => {
  const t = tool("repos_worktree_cleanup", { readOnlyHint: false, destructiveHint: true });
  it.each([[{}], [{ action: "list" }], [{ action: "remove", dryRun: true, items: [] }]])("only looks for %j", (args) => {
    expect(slackToolRisk(t, args)).toEqual({ confirm: false, destructive: false });
  });
  it.each([[{ action: "remove", items: [{ repo: "a", path: "/p" }], confirm: true }], [{ action: "remove", all: true, confirm: true }], [{ action: "remove", dryRun: false }]])("removing %j is the red Confirm", (args) => {
    expect(slackToolRisk(t, args)).toEqual({ confirm: true, destructive: true });
  });
});

describe("Slack-side risk overrides", () => {
  it("confirms teammate messages and makes handoffs destructive regardless of annotations", () => {
    expect(slackToolRisk(tool("task_ask_teammate", readOnly), {})).toEqual({ confirm: true, destructive: false });
    expect(slackToolRisk(tool("task_handoff", readOnly), {})).toEqual({ confirm: true, destructive: true });
  });
  it("makes datadog_investigate (annotated read-only, starts an agent) need Confirm without calling it destructive", () => {
    const t = tool("datadog_investigate", readOnly);
    expect(t).toMatchObject({ readOnly: false, destructive: false });
    expect(slackReadOnly(t)).toBe(false);
    expect(slackToolRisk(t, { title: "5xx" })).toEqual({ confirm: true, destructive: false });
  });
  it("always confirms repo_learn because a missing or stale cache regenerates", () => {
    const t = tool("repo_learn", readOnly);
    expect(slackToolRisk(t, { name: "devhub" })).toEqual({ confirm: true, destructive: false });
    expect(slackToolRisk(t, { name: "devhub", refresh: false })).toEqual({ confirm: true, destructive: false });
    expect(slackReadOnly(t)).toBe(false);
    expect(slackToolRisk(t, { name: "devhub", refresh: true })).toEqual({ confirm: true, destructive: false });
  });
  it.each(["scripts_run", "agent_dispatch", "agent_race", "agent_followup", "agent_cancel", "jobs_create", "jobs_update", "jobs_delete", "jobs_run", "db_execute", "db_cancel"])(
    "%s is always a red Confirm, whatever the MCP annotation says", (name) => {
      for (const hints of [readOnly, write, { readOnlyHint: false, destructiveHint: true }]) {
        expect(slackToolRisk(tool(name, hints), {})).toEqual({ confirm: true, destructive: true });
      }
      expect(slackReadOnly(tool(name, readOnly))).toBe(false);
    },
  );
  it.each([
    ["repos_git_worktrees", {}, false, false], ["repos_git_worktrees", { action: "list" }, false, false], ["repos_git_worktrees", { action: "review" }, false, false],
    ["repos_git_worktrees", { action: "add" }, true, false], ["repos_git_worktrees", { action: "prune" }, true, false],
    ["repos_git_worktrees", { action: "remove", path: "/x" }, true, true], ["repos_git_worktrees", { action: "remove", path: "/x", force: true }, true, true], ["repos_git_worktrees", { action: "cleanup" }, true, true],
    ["repos_git_branch", { action: "checkout" }, true, false], ["repos_git_branch", { action: "fetch" }, true, false],
    ["repos_git_branch", { action: "delete-branch" }, true, true], ["repos_git_branch", { action: "push" }, true, true], ["repos_git_branch", { action: "undo-commit" }, true, true], ["repos_git_branch", {}, true, true],
    ["repos_git_stash", { action: "list" }, false, false], ["repos_git_stash", { action: "show" }, false, false], ["repos_git_stash", { action: "save" }, true, false],
    ["repos_git_stash", { action: "drop" }, true, true], ["repos_git_stash", { action: "pop" }, true, true], ["repos_git_stash", { action: "something-new" }, true, true],
  ])("%s %j → confirm=%s destructive=%s (rated by action)", (name, args, confirm, destructive) => {
    expect(slackToolRisk(tool(name, write), args)).toEqual({ confirm, destructive });
  });
  it("leaves every other tool as the MCP server rates it", () => {
    expect(slackToolRisk(tool("calendar_list", readOnly), {})).toEqual({ confirm: false, destructive: false });
    expect(slackToolRisk(tool("notes_write", write), {})).toEqual({ confirm: true, destructive: false });
    expect(slackToolRisk(tool("notes_delete", { readOnlyHint: false, destructiveHint: true }), {})).toEqual({ confirm: true, destructive: true });
    expect(slackToolRisk(tool("mystery", { readOnlyHint: false }), {})).toEqual({ confirm: true, destructive: true });
    expect(slackReadOnly(tool("calendar_list", readOnly))).toBe(true);
  });
});
