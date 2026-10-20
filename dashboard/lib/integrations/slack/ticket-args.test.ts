import { describe, expect, it } from "vitest";
import type { SlackTool } from "./mcp-catalog";
import { commandRule, enumFromText, extractRefs, extractToolArgs, matchTransition, parseDay, parseTransitions, PLAN_ONLY_NOTE, rankTaskMatches, taskIdField } from "./ticket-args";

function tool(name: string, properties: Record<string, unknown>, required: string[] = []): SlackTool {
  return { name, description: "", readOnly: false, destructive: false, category: "t", inputSchema: { type: "object", properties, required } };
}
const day = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const task = { taskId: "task-1", date: "2026-10-12", title: "Ad slot", profile: "work" };
// Sunday 18 Oct 2026, local time.
const now = new Date(2026, 9, 18, 20, 30);

describe("extractRefs", () => {
  it("finds Jira keys, task ids, note paths, PR refs and URLs", () => {
    const refs = extractRefs("start PTF-1234 and see <https://github.com/acme/web/pull/42|PR> plus acme/api#7, task-notes/2026-10-01-abc123 and 0f8fad5b-d9cb-469f-a165-70867728950e");
    expect(refs.jiraKeys).toEqual(["PTF-1234"]);
    expect(refs.taskIds).toEqual(["abc123", "0f8fad5b-d9cb-469f-a165-70867728950e"]);
    expect(refs.taskDates).toEqual({ abc123: "2026-10-01" });
    expect(refs.prs).toEqual([{ repo: "acme/web", number: 42, url: "https://github.com/acme/web/pull/42" }, { repo: "acme/api", number: 7 }]);
    expect(refs.urls).toEqual(["https://github.com/acme/web/pull/42"]);
  });
  it("accepts a lower-case key only when no upper-case one is present, and never inside a UUID", () => {
    expect(extractRefs("start ptf-77").jiraKeys).toEqual(["PTF-77"]);
    expect(extractRefs("start PTF-77 with gpt-6").jiraKeys).toEqual(["PTF-77"]);
    expect(extractRefs("0f8fad5b-d9cb-469f-a165-70867728950e").jiraKeys).toEqual([]);
  });
});

describe("parseDay", () => {
  it.each([
    ["today", "2026-10-18"], ["tomorrow", "2026-10-19"], ["yesterday", "2026-10-17"],
    ["on friday", "2026-10-23"], ["sunday", "2026-10-18"], ["next sunday", "2026-10-25"], ["last monday", "2026-10-12"],
    ["due 2026-11-02", "2026-11-02"],
  ])("%s → %s", (text, expected) => expect(parseDay(text, now)).toBe(expected));
  it("rejects impossible dates and text without a day", () => {
    expect(parseDay("2026-02-31", now)).toBeUndefined();
    expect(parseDay("start PTF-1", now)).toBeUndefined();
  });
});

describe("enumFromText", () => {
  it("maps words and synonyms to exactly one value", () => {
    expect(enumFromText(["draft", "ready"], "mark it ready")).toBe("ready");
    expect(enumFromText(["complete", "abandon", "reactivate"], "this one is done")).toBe("complete");
    expect(enumFromText(["answer", "retry", "auto-retry", "clear", "open-pr"], "auto retry PTF-1")).toBe("auto-retry");
    expect(enumFromText(["answer", "retry", "auto-retry", "clear", "open-pr"], "retry PTF-1")).toBe("retry");
  });
  it("leaves the field alone when nothing or several values match", () => {
    expect(enumFromText(["draft", "ready"], "start it")).toBeUndefined();
    expect(enumFromText(["draft", "ready"], "draft or ready?")).toBeUndefined();
  });
});

describe("extractToolArgs", () => {
  it("fills the task id and day from the resolved task", () => {
    expect(extractToolArgs(tool("storyboard_start_auto", { taskId: { type: "string" }, taskDate: day }, ["taskId", "taskDate"]), "start PTF-1 on auto", task, now)).toEqual({ taskId: "task-1", taskDate: "2026-10-12" });
    expect(extractToolArgs(tool("tasks_set_stage", { taskId: { type: "string" }, date: day, stage: { type: "string", enum: ["draft", "ready"] } }, ["taskId", "date", "stage"]), "mark PTF-1 ready", task, now)).toEqual({ taskId: "task-1", date: "2026-10-12", stage: "ready" });
  });
  it("uses `id` only when it is described as a task id", () => {
    expect(taskIdField(tool("tasks_update", { id: { type: "string", description: "Task ID (UUID)" } }))).toBe("id");
    expect(taskIdField(tool("task_note_update", { id: { type: "string", description: "Item id from a previous result" } }))).toBeUndefined();
  });
  it("reads a due day and a capture day from words when there is no task", () => {
    expect(extractToolArgs(tool("tasks_update", { id: { type: "string", description: "Task ID" }, date: day, due: { type: ["string", "null"] } }, ["id"]), "PTF-1 due friday", task, now)).toEqual({ id: "task-1", date: "2026-10-12", due: "2026-10-23" });
    expect(extractToolArgs(tool("tasks_capture", { text: { type: "string" }, date: day }, ["text"]), "capture idea for tomorrow", undefined, now)).toEqual({ date: "2026-10-19" });
    expect(extractToolArgs(tool("calendar_day", { date: day }, ["date"]), "meetings tomorrow", undefined, now)).toEqual({ date: "2026-10-19" });
  });
  it("fills PR repo, number and URL", () => {
    const pr = tool("prs_open_in_cursor", { repo: { type: "string" }, number: { type: "integer" }, url: { type: "string", description: "GitHub PR URL" } }, ["repo", "number"]);
    expect(extractToolArgs(pr, "open https://github.com/acme/web/pull/42 in cursor", undefined, now)).toEqual({ repo: "acme/web", number: 42, url: "https://github.com/acme/web/pull/42" });
    expect(extractToolArgs(pr, "open acme/web#9", undefined, now)).toEqual({ repo: "acme/web", number: 9 });
  });
  it("never fills optional enums it wasn't asked about", () => {
    expect(extractToolArgs(tool("x", { severity: { type: "string", enum: ["high", "low"] } }), "high priority", undefined, now)).toEqual({});
  });
});

describe("commandRule", () => {
  it.each([
    ["start PTF-1234 on auto", "storyboard_start_auto", {}, undefined],
    ["Start PTF-1234", "storyboard_start_auto", {}, undefined],
    ["start PTF-1234 on plan", "tasks_agent_plan", {}, PLAN_ONLY_NOTE],
    ["plan PTF-1234", "tasks_agent_plan", {}, PLAN_ONLY_NOTE],
    ["start planning ptf-1234", "tasks_agent_plan", {}, PLAN_ONLY_NOTE],
    ["implement PTF-1234", "tasks_agent_resume", {}, undefined],
    ["resume PTF-1234", "tasks_agent_resume", {}, undefined],
    ["mark PTF-1234 ready", "tasks_set_stage", { stage: "ready" }, undefined],
    ["move PTF-1234 back to draft", "tasks_set_stage", { stage: "draft" }, undefined],
    ["note PTF-1234: check the ad slot", "task_note_add", { id: "PTF-1234", text: "check the ad slot" }, undefined],
    ["add a note to PTF-1234 - Ship It", "task_note_add", { id: "PTF-1234", text: "Ship It" }, undefined],
    ["<@UBOT> please start PTF-1234 on auto.", "storyboard_start_auto", {}, undefined],
  ])("%s", (text, name, args, note) => {
    const route = commandRule(text);
    if (!name) return expect(route?.kind).toBe("transition");
    expect(route).toEqual({ kind: "tool", tool: name, args, ...(note ? { note } : {}) });
  });
  it("routes moves to a Jira transition and keeps the target's case", () => {
    expect(commandRule("move PTF-1234 to Code Review")).toEqual({ kind: "transition", key: "PTF-1234", target: "Code Review" });
  });
  it("keeps start on auto on auto, and plan never means auto", () => {
    expect(commandRule("start PTF-1234 on auto")).toMatchObject({ tool: "storyboard_start_auto" });
    expect(commandRule("plan PTF-1234")).toMatchObject({ tool: "tasks_agent_plan", note: expect.stringContaining("read-only sandbox") });
  });
  it.each([
    ["done PTF-1234", "done", { key: "PTF-1234" }],
    ["Done ptf-1234.", "done", { key: "PTF-1234" }],
    ["mark PTF-1234 as done", "done", { key: "PTF-1234" }],
    ["please complete PTF-1234", "done", { key: "PTF-1234" }],
    ["done with 7d1c6c3a-2b4e-4f5a-9d1b-1c2d3e4f5a6b", "done", { taskId: "7d1c6c3a-2b4e-4f5a-9d1b-1c2d3e4f5a6b" }],
    ["done fix the feed fallback", "done", { words: "fix the feed fallback" }],
    ["check off update the runbook", "done", { words: "update the runbook" }],
    ["reopen PTF-1234", "open", { key: "PTF-1234" }],
    ["re-open ptf-9", "open", { key: "PTF-9" }],
    ["reopen the feed fallback", "open", { words: "feed fallback" }],
  ])("%s is a free task-state command", (text, state, target) => {
    expect(commandRule(text)).toEqual({ kind: "task-state", state, target });
  });
  it.each([
    ["add task fix the retry loop", "fix the retry loop"],
    ["Add a task: Call Sam about PTF-1234 #ops", "Call Sam about PTF-1234 #ops"],
    ["add a new todo - renew the cert https://example.com/x", "renew the cert https://example.com/x"],
    ["todo buy milk", "buy milk"],
    ["todo: ship it", "ship it"],
    ["task: write the postmortem", "write the postmortem"],
    ["<@UBOT> new task review Sam's PR", "review Sam's PR"],
  ])("%s captures a task and keeps its case", (text, saved) => {
    expect(commandRule(text)).toEqual({ kind: "capture", text: saved });
  });
  it("caps a captured title at the 500 characters the capture endpoint takes", () => {
    expect((commandRule(`add task ${"x".repeat(900)}`) as { text: string }).text).toHaveLength(500);
  });
  it.each(["done", "done today", "what's done", "tasks done this week", "done tasks", "todo", "todo list", "to do", "task done", "completed tasks", "reopen", "complete it", "done so", "what should I do about PTF-1"])("%j is a question or a status word, not a command", (text) => {
    expect(commandRule(text)).toBeNull();
  });
  it("ignores questions and anything without a ticket", () => {
    expect(commandRule("what's the plan for PTF-1234?")).toBeNull();
    expect(commandRule("start the build")).toBeNull();
    expect(commandRule("status of PTF-1234")).toBeNull();
  });
});

describe("transitions and task ranking", () => {
  const listing = "Available transitions for PTF-1:\n- 11: To Do\n- 21: In Progress\n- 31: Code Review\n\nApply with jira_ticket_transition(key, transitionId, confirm: true).";
  it("parses the listing and matches names loosely but uniquely", () => {
    const transitions = parseTransitions(listing);
    expect(transitions).toEqual([{ id: "11", name: "To Do" }, { id: "21", name: "In Progress" }, { id: "31", name: "Code Review" }]);
    expect(matchTransition(transitions, "code review")?.id).toBe("31");
    expect(matchTransition(transitions, "review")?.id).toBe("31");
    expect(matchTransition(transitions, "todo")).toBeUndefined();
    expect(matchTransition(transitions, "to-do")?.id).toBe("11");
  });
  it("prefers the ticket's own open task", () => {
    const matches = [{ ...task, taskId: "a", own: false }, { ...task, taskId: "b", own: true, done: true }, { ...task, taskId: "c", own: true }];
    expect(rankTaskMatches(matches).map((match) => match.taskId)).toEqual(["c"]);
    expect(rankTaskMatches([{ ...task, taskId: "a" }, { ...task, taskId: "b" }])).toHaveLength(2);
  });
});
