import { describe, expect, it } from "vitest";
import type { SlackTool } from "./mcp-catalog";
import { guessTools, timeAnswer } from "./fallback";
import { directToolRule } from "./tool-args";
import { routeSlackMessage } from "./router";

const tool = (name: string, description: string, write = false) =>
  ({ name, description, readOnly: !write, destructive: write, category: "x", inputSchema: { type: "object", properties: {} } }) as unknown as SlackTool;

describe("guessTools", () => {
  const tools = [tool("jira_tickets", "Jira tickets assigned to you"), tool("notes_search", "Search notes"), tool("jira_transition", "Move a Jira ticket", true)];
  it("ranks read-only tools sharing words with the message", () => {
    expect(guessTools("show jira tickets please", tools).map((t) => t.name)).toEqual(["jira_tickets"]);
  });
  it("never suggests write tools and returns nothing for filler", () => {
    expect(guessTools("move the jira ticket", tools).map((t) => t.name)).not.toContain("jira_transition");
    expect(guessTools("what is it", tools)).toEqual([]);
  });
});

describe("free rules", () => {
  it("answers time questions", () => {
    for (const text of ["What time is it?", "what's the time", "what day is it", "time"]) expect(directToolRule(text)).toEqual({ kind: "time" });
    expect(directToolRule("note PTF-1: time is tight")).toBeNull();
    expect(timeAnswer(new Date("2026-10-18T22:41:00Z"))).toMatch(/^It's \d\d:\d\d on Sunday 18 October|^It's \d\d:\d\d on Monday 19 October/);
  });
  it("maps 'assigned to me' to Jira tickets", () => {
    expect(directToolRule("What tasks are assigned to me?")).toEqual({ kind: "tool", tool: "jira_tickets", args: {} });
    expect(directToolRule("move the ticket assigned to me to done")).toBeNull();
  });
  it("maps 'my tasks' to today's list", () => {
    for (const text of ["my tasks", "what are my tasks?", "tasks today", "what's on today"]) expect(routeSlackMessage(text, { activeProfile: "work", profiles: [] }).kind).toBe("today");
  });
});
