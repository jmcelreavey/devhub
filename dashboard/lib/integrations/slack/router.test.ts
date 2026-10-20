import { describe, expect, it } from "vitest";
import { routeSlackMessage } from "./router";

const context = { activeProfile: "work", profiles: ["work", "personal", "side-project"] };
describe("deterministic Slack routing", () => {
  it.each(["help", "HELP!", "hi", "what can you do?", ""])("routes help: %s", (text) => {
    expect(routeSlackMessage(text, context)).toEqual({ kind: "help", profile: "work" });
  });
  it.each(["PTF-5135", "where's ptf-5135?", "status of PTF-5135", "is PTF-5135 done?", "what's happening in PTF-5135?"])("routes Jira first: %s", (text) => {
    expect(routeSlackMessage(text, context)).toEqual({ kind: "task", profile: "work", jiraKey: "PTF-5135" });
  });
  it.each([
    ["to do", "todo"], ["what's in to-do?", "todo"], ["todo", "todo"],
    ["what’s running?", "running"], ["in progress", "running"],
    ["what's in review?", "in-review"], ["ready for review", "in-review"], ["draft PR", "in-review"],
    ["blocked", "blocked"], ["what's done?", "done"], ["completed", "done"],
  ])("routes %s to %s", (text, status) => {
    expect(routeSlackMessage(text, context)).toEqual({ kind: "status", profile: "work", status });
  });
  it.each(["done PTF-5135", "reopen PTF-5135", "mark PTF-5135 done", "done fix the feed fallback", "plan PTF-5135", "add task renew the cert", "todo buy milk", "task: write it up",
    "meetings today", "any meetings tomorrow?", "calendar", "next meeting", "prs", "owned prs", "review requests", "my tickets", "jira", "worktrees"])("leaves a command or free view to the tool router: %s", (text) => {
    expect(routeSlackMessage(text, context)).toEqual({ kind: "unknown", profile: "work" });
  });
  it("still answers the plain status words these commands start with", () => {
    expect(routeSlackMessage("what's done?", context)).toEqual({ kind: "status", profile: "work", status: "done" });
    expect(routeSlackMessage("done today", context).kind).toBe("today");
    expect(routeSlackMessage("todo", context)).toEqual({ kind: "status", profile: "work", status: "todo" });
  });
  it.each(["needs me", "needs you", "what's waiting?", "what is waiting", "waiting on me"])("uses Needs you: %s", (text) => {
    expect(routeSlackMessage(text, context)).toEqual({ kind: "needs-you", profile: "work" });
  });
  it.each(["today", "what are today's tasks?"])("routes today: %s", (text) => {
    expect(routeSlackMessage(text, context)).toEqual({ kind: "today", profile: "work" });
  });
  it.each(["auto status", "what's in auto mode?", "automation status"])("routes auto status: %s", (text) => {
    expect(routeSlackMessage(text, context)).toEqual({ kind: "auto-status", profile: "work" });
  });
  it.each(["today in personal", "in PERSONAL today", "<@UBOT> today in personal?"])("scopes one query: %s", (text) => {
    expect(routeSlackMessage(text, context)).toEqual({ kind: "today", profile: "personal" });
    expect(context.activeProfile).toBe("work");
    expect(routeSlackMessage("today", context).profile).toBe("work");
  });
  it("supports any known profile, including hyphens", () => {
    expect(routeSlackMessage("in side-project needs me", context)).toEqual({ kind: "needs-you", profile: "side-project" });
    expect(routeSlackMessage("what's in review in personal?", context)).toEqual({ kind: "status", profile: "personal", status: "in-review" });
  });
  it("does not fall back to the active profile for an unknown explicit scope", () => {
    expect(routeSlackMessage("today in missing", context)).toEqual({ kind: "unknown-profile", profile: "work", requested: "missing" });
    expect(routeSlackMessage("today in work in personal", context).kind).toBe("unknown");
  });
  it.each(["move PTF-5135 to Code Review", "mark PTF-5135 ready", "note PTF-5135: check it", "plan PTF-5135", "implement PTF-5135"])("leaves ticket commands to the tool router: %s", (text) => {
    expect(routeSlackMessage(text, context)).toEqual({ kind: "unknown", profile: "work" });
  });
  it.each(["start PTF-5135", "retry PTF-5135", "approve everything", "delete done tasks", "summarise the week", "undone", "PTF-0"])("does not infer actions or loose keywords: %s", (text) => {
    expect(routeSlackMessage(text, context)).toEqual({ kind: "unknown", profile: "work" });
  });
  it("uses the legacy profile without inventing other profiles", () => {
    expect(routeSlackMessage("today", { activeProfile: "legacy", profiles: [] })).toEqual({ kind: "today", profile: "legacy" });
  });
  it("supports profiles named after status words without changing natural status questions", () => {
    const namedStatuses = { activeProfile: "work", profiles: ["work", "done", "review"] };
    expect(routeSlackMessage("today in done", namedStatuses)).toEqual({ kind: "today", profile: "done" });
    expect(routeSlackMessage("in review needs me", namedStatuses)).toEqual({ kind: "needs-you", profile: "review" });
    expect(routeSlackMessage("what's in review?", namedStatuses)).toEqual({ kind: "status", profile: "work", status: "in-review" });
  });
});
