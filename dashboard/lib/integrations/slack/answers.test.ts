import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTask } from "@shared/tasks/store.ts";
import { getActiveTasksDir } from "@/lib/content/dirs";
import { todayISO } from "@/lib/utils";
import { emptyWorkflow } from "@/lib/workflows/store";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { answerSlackMessage, buildSlackAnswer, loadSlackSnapshot, type SlackSnapshot } from "./answers";
import { routeSlackMessage } from "./router";

const now = Date.parse("2026-10-18T12:00:00Z");
const base: BoardCard = {
  taskId: "task-1", title: "PTF-5135 · A task", jira: ["PTF-5135"], date: "2026-10-18", status: "todo", taskDone: false,
  notePath: "task-notes/task-1", noteHref: "/notes/task-notes/task-1", tags: [], links: [], models: [], summary: [],
  counts: { openQuestions: 0, openBugs: 0, blockerBugs: 0, decisions: 0 }, screenshot: null, images: [], jev: null,
  tiers: null, run: null, steps: [], updatedAt: "2026-10-18T11:59:00Z", attention: null,
};
const context = { activeProfile: "work", profiles: ["work", "personal"] };
const snapshot = (cards: BoardCard[], patch: Partial<SlackSnapshot> = {}): SlackSnapshot => ({ cards, items: [], todayTaskIds: [], errors: [], ...patch });
const answer = (text: string, data: SlackSnapshot) => buildSlackAnswer(routeSlackMessage(text, context), data, now);

describe("Slack answers use the Storyboard's status and next action", () => {
  it("returns a Jira task's board status, one next action and a scoped task link", () => {
    expect(answer("where's PTF-5135?", snapshot([base]))).toMatchObject({ profile: "work", title: "PTF-5135", href: "/storyboard?task=task-1&profile=work", more: 0 });
    expect(answer("PTF-5135", snapshot([base])).lines[0]).toContain("To do");
    expect(answer("PTF-5135", snapshot([base])).lines[0]).toContain("Next: Start on auto");
  });
  it("does not invent an unlinked Jira task", () => {
    expect(answer("PTF-9999", snapshot([base])).lines).toEqual(["No task linked to PTF-9999 in this profile."]);
  });
  it("maps only a single-task card to a reaction target, never an ambiguous list", () => {
    expect(answer("PTF-5135", snapshot([base])).taskRef).toEqual({ profile: "work", taskId: "task-1", date: base.date, title: base.title });
    expect(answer("PTF-5135", snapshot([base, { ...base, taskId: "task-2" }])).taskRef).toBeUndefined();
    expect(answer("PTF-9999", snapshot([base])).taskRef).toBeUndefined();
  });
  it("never tells someone a blocked task needs no action", () => {
    expect(answer("PTF-5135", snapshot([{ ...base, status: "blocked" }])).lines[0]).toContain("Next: Open in DevHub");
    expect(answer("PTF-5135", snapshot([{ ...base, status: "done", taskDone: true }])).lines[0]).toContain("Next: No action needed");
  });
  it.each([
    ["to do", "todo"], ["in review", "draft-pr"], ["in review", "ready-for-review"], ["blocked", "blocked"], ["done", "done"],
  ] as const)("lists %s from the board's %s column", (query, status) => {
    const data = snapshot([{ ...base, status }, { ...base, taskId: "other", title: "Wrong column", status: "planning" }]);
    expect(answer(query, data).lines).toHaveLength(1);
    expect(answer(query, data).lines[0]).toContain(base.title);
  });
  it("matches Home's running rules and excludes paused/blocked work", () => {
    const live = { ...base, status: "in-progress" as const, run: { runId: "run-1", status: "running", startedAt: base.updatedAt } };
    const result = answer("what's running?", snapshot([live, { ...live, taskId: "paused", title: "Paused", run: { ...live.run, status: "paused" } }, { ...live, taskId: "blocked", title: "Blocked", status: "blocked" }]));
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toContain("Next: View progress");
  });
  it("uses Home's Needs you resolver, including workflow failures and dedupe", () => {
    const question = { ...base, counts: { ...base.counts, openQuestions: 1 } };
    const failed = { ...base, taskId: "failed", title: "Failed workflow" };
    const workflow = { ...emptyWorkflow("failed"), status: "blocked" as const, runStates: { run: { state: "failed" as const, at: now } } };
    const result = answer("needs me", snapshot([question, question, failed, { ...base, taskId: "ordinary", title: "Ordinary" }], { items: [{ task: { id: "failed", text: "Failed", rank: "1", startDate: base.date, done: false, createdAt: base.updatedAt }, workflow }] }));
    expect(result.lines).toHaveLength(2);
    expect(result.lines.join("\n")).toMatch(/Next: Answer/);
    expect(result.lines.join("\n")).toMatch(/Inspect failure/);
    expect(result.lines.join("\n")).not.toContain("Ordinary");
  });
  it("uses today's task membership rather than only tasks first created today", () => {
    const result = answer("today", snapshot([{ ...base, date: "2026-10-01" }, { ...base, taskId: "future", title: "Future" }], { todayTaskIds: [base.taskId] }));
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toContain(base.title);
  });
  it("includes the auto phase and its one next action", () => {
    const auto = { ...base, auto: { status: "needs-you" as const, phase: "fix", label: "Fix", round: 2, maxRounds: 2, waiting: { kind: "cap" as const, reason: "Two rounds used" } } };
    expect(answer("auto status", snapshot([auto, { ...base, taskId: "manual", title: "Manual" }])).lines).toHaveLength(1);
    expect(answer("auto status", snapshot([auto])).lines[0]).toContain("Next: One more round");
  });
  it("caps lists at eight and counts the rest", () => {
    const result = answer("to do", snapshot(Array.from({ length: 11 }, (_, index) => ({ ...base, taskId: `task-${index}` }))));
    expect(result.lines).toHaveLength(8);
    expect(result.more).toBe(3);
    expect(result.total).toBe(11);
    expect(result.items).toHaveLength(8);
    expect(result.items?.[0]).toMatchObject({ title: base.title, href: "/storyboard?task=task-0&profile=work", status: "📝 To do" });
  });
  it("keeps the expanded help short enough for the Slack card without hiding confirmation guidance", () => {
    const help = buildSlackAnswer({ kind: "help", profile: "work" });
    expect(help.lines.every((line) => line.length <= 180)).toBe(true);
    expect(help.lines.join("\n")).toContain("what PRs do I have?");
    expect(help.lines.join("\n")).toContain("Changes ask you to Confirm");
  });
  it("offers help for unknown messages and reports incomplete data without exposing errors", () => {
    expect(answer("banana", snapshot([]))).toMatchObject({ kind: "unknown", title: "I didn't recognise that. Try “help”." });
    const result = answer("today", snapshot([base], { errors: ["private/path/token"] }));
    expect(result.kind).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("private/path/token");
  });
});

describe("Slack profile reads stay request-local", () => {
  let root: string | undefined;
  afterEach(() => { vi.unstubAllEnvs(); if (root) fs.rmSync(root, { recursive: true, force: true }); });
  it("labels legacy data explicitly and pins links to real profiles named default", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "slack-legacy-"));
    vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
    vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
    vi.stubEnv("DEVHUB_CONFIG_DIR", path.join(root, "config"));
    vi.stubEnv("DEVHUB_PROFILE", "default");
    createTask(path.join(root, "tasks"), { text: "Legacy-only task", startDate: todayISO() });
    expect(answerSlackMessage("today")).toMatchObject({ profile: "legacy", href: expect.stringContaining("profile=legacy") });
    createTask(path.join(root, "tasks", "default"), { text: "Default-profile task", startDate: todayISO() });
    expect(answerSlackMessage("today")).toMatchObject({ profile: "default", href: expect.stringContaining("profile=default") });
  });
  it("reads only the selected profile, leaves the active profile alone, and rejects unknown paths", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "slack-profile-"));
    vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
    vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
    vi.stubEnv("DEVHUB_PROFILE", "work");
    vi.stubEnv("DEVHUB_CONFIG_DIR", path.join(root, "config"));
    createTask(path.join(root, "tasks", "work"), { text: "Work-only task", startDate: todayISO() });
    createTask(path.join(root, "tasks", "personal"), { text: "Personal-only task", startDate: todayISO() });
    expect(loadSlackSnapshot("personal").cards.map((card) => card.title)).toEqual(["Personal-only task"]);
    expect(answerSlackMessage("today in personal").lines.join("\n")).toContain("Personal-only task");
    expect(answerSlackMessage("today").lines.join("\n")).not.toContain("Personal-only task");
    expect(getActiveTasksDir()).toBe(path.join(root, "tasks", "work"));
    expect(() => loadSlackSnapshot("../work")).toThrow("Unknown task profile");
    expect(answerSlackMessage("today in missing").kind).toBe("unknown");
  });
});
