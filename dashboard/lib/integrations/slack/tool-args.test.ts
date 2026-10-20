import { describe, expect, it } from "vitest";
import type { SlackTool } from "./mcp-catalog";
import { directToolRule, fillArgsFromText, mergeToolArgs, validateToolArgs } from "./tool-args";

function tool(properties: Record<string, unknown>, required: string[] = []): SlackTool {
  return { name: "t", description: "", readOnly: true, destructive: false, category: "t", inputSchema: { type: "object", properties, required, additionalProperties: false } };
}

describe("validateToolArgs", () => {
  it("does not reuse another server's schema with the same $id", () => {
    const first = { ...tool({ action: { const: "read" } }), inputSchema: { $id: "https://example.test/shared", type: "object", properties: { action: { const: "read" } } } };
    const second = { ...first, inputSchema: { ...first.inputSchema, properties: { action: { const: "delete" } } } };
    expect(validateToolArgs(first, { action: "read" }).ok).toBe(true);
    expect(validateToolArgs(second, { action: "read" }).ok).toBe(false);
    expect(validateToolArgs(second, { action: "delete" }).ok).toBe(true);
  });
  it("reports nested required fields and merges inferred fields without changing selected operations", () => {
    const nested = tool({ request: { type: "object", properties: { op: { enum: ["read"] }, id: { type: "string" } }, required: ["id", "op"] } });
    expect(validateToolArgs(nested, { request: { op: "read" } })).toMatchObject({ ok: false, missing: ["id"] });
    expect(mergeToolArgs({ request: { op: "delete", id: "123" } }, { request: { op: "read" } })).toEqual({ request: { op: "read", id: "123" } });
  });
  const t = tool({ key: { type: "string" }, limit: { type: "integer", minimum: 1 } }, ["key"]);
  it("accepts valid arguments", () => expect(validateToolArgs(t, { key: "PTF-1", limit: 3 })).toEqual({ ok: true, args: { key: "PTF-1", limit: 3 } }));
  it("reports missing required fields", () => expect(validateToolArgs(t, {})).toMatchObject({ ok: false, missing: ["key"] }));
  it("rejects wrong types and unknown fields", () => {
    expect(validateToolArgs(t, { key: 4 }).ok).toBe(false);
    expect(validateToolArgs(t, { key: "a", extra: true }).ok).toBe(false);
  });
  it("rejects non-objects", () => expect(validateToolArgs(t, "PTF-1").ok).toBe(false));
});

describe("fillArgsFromText", () => {
  it("takes the Jira key and profile only for properties the tool declares", () => {
    expect(fillArgsFromText(tool({ key: { type: "string" }, profile: { type: "string" } }, ["key"]), "details for ptf-77", "work")).toEqual({ key: "PTF-77", profile: "work" });
    expect(fillArgsFromText(tool({ count: { type: "integer" } }), "details for ptf-77", "work")).toEqual({});
  });
  it("fills a required query from the message but leaves optional ones alone", () => {
    expect(fillArgsFromText(tool({ query: { type: "string" } }, ["query"]), " retries ", "work")).toEqual({ query: "retries" });
    expect(fillArgsFromText(tool({ query: { type: "string" } }), "retries", "work")).toEqual({});
  });
});

describe("directToolRule", () => {
  it.each(["what's the time?", "whats the time", "what’s the time?"])("answers %s with the free time rule", (text) => {
    expect(directToolRule(text)).toEqual({ kind: "time" });
  });
  it.each(["What model are you using?", "which model are you running", "what model"])("answers %s with the free model rule", (text) => {
    expect(directToolRule(text)).toEqual({ kind: "model" });
  });
  it("routes my assigned tasks to Jira without Jev", () => {
    expect(directToolRule("my assigned tasks")).toEqual({ kind: "tool", tool: "jira_tickets", args: {} });
  });
  it.each([
    ["meetings this week", "calendar_week"], ["my briefing", "briefing_get"], ["my tickets", "jira_tickets"], ["jira", "jira_tickets"], ["my jira tickets?", "jira_tickets"],
    ["standup", "standup_markdown"], ["scheduled jobs", "jobs_list"], ["running agents", "agent_runs"], ["dashboard status", "status_services"],
  ])("%s → %s", (text, name) => expect(directToolRule(text)).toEqual({ kind: "tool", tool: name, args: {} }));
  it("keeps the original case of a search query", () => expect(directToolRule("Search for Deploy Runbook?")).toEqual({ kind: "tool", tool: "search", args: { query: "Deploy Runbook" } }));
  it.each(["cost", "usage", "usage today", "what did slack cost", "what's my usage today?", "how much have I spent", "show me the cost today", "what does jev cost this week"])("%j is a usage question", (text) => {
    expect(directToolRule(text)).toEqual({ kind: "usage" });
  });
  it.each([["my events this week", "calendar_week"], ["what's on my calendar next week", "calendar_week"]])("%j is the week view", (text, name) => expect(directToolRule(text)).toEqual({ kind: "tool", tool: name, args: {} }));
  describe("the day and next-meeting views (2026-10-18 is a Sunday)", () => {
    const now = new Date(2026, 9, 18, 9, 0);
    it.each([
      ["calendar", { day: "2026-10-18" }], ["meetings today", { day: "2026-10-18" }], ["what's on my calendar", { day: "2026-10-18" }],
      ["any meetings tomorrow?", { day: "2026-10-19" }], ["what meetings do I have today", { day: "2026-10-18" }], ["meetings friday", { day: "2026-10-23" }],
      ["next meeting", { next: true }], ["what's my next meeting?", { next: true }], ["when is the next meeting", { next: true }],
    ])("%j", (text, when) => expect(directToolRule(text, now)).toEqual({ kind: "calendar", when }));
  });
  it.each(["prs", "my prs", "open prs?", "owned prs", "review requests", "what PRs do I have?", "pull requests", "prs waiting on me"])("%j is the PR card", (text) => {
    expect(directToolRule(text)).toEqual({ kind: "prs" });
  });
  it.each(["worktrees", "my worktrees", "clean up worktrees", "stale worktrees?", "worktree cleanup"])("%j is the worktree list", (text) => {
    expect(directToolRule(text)).toEqual({ kind: "worktrees" });
  });
  it.each(["merge the prs into main", "prs for PTF-1 need a rebase please", "tickets for the feed are slow today and I want a refund", "delete my worktrees", "worktrees are in ~/dev"])("%j is anchored out of the free views", (text) => {
    const route = directToolRule(text);
    expect(route === null || !["prs", "worktrees"].includes(route.kind)).toBe(true);
  });
  it.each([
    "note PTF-1: cost was high", "note PTF-1: prepped for the meeting", "log PTF-2 - the usage graph is wrong", "the cost of the feed is too high", "usage of the cache is down in prod",
    "reschedule the meeting with Sam", "add an event to the retro doc", "what did the deploy cost us in time on PTF-9",
  ])("%j is not swallowed by a keyword rule", (text) => {
    const route = directToolRule(text);
    expect(route === null || (route.kind !== "usage" && !(route.kind === "tool" && route.tool.startsWith("calendar")))).toBe(true);
  });
  it("knows cost, usage and refresh, and ignores everything else", () => {
    expect(directToolRule("what's my usage today")).toEqual({ kind: "usage" });
    expect(directToolRule("refresh the tool list")).toEqual({ kind: "refresh-tools" });
    expect(directToolRule("delete the done tasks")).toBeNull();
  });
});
