import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTask, deleteTask, findTask, patchTask, startTimer, writeItem } from "@shared/tasks/store.ts";
import { isTaskReadyForAgent } from "@shared/tasks/types.ts";
import { slackNeedsFromHome } from "@/lib/integrations/slack/needs-you-source";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
const roots: string[] = [];
afterEach(() => { for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
describe("task ownership guards", () => {
  it("persists a pending pickup atomically and blocks every ordinary mutation", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-pending-pickup-")); roots.push(directory);
    const task = createTask(directory, { text: "Imported task", stage: "draft", teamPickup: { handoffId: "h1", cwd: "/kept/worktree", branch: "feature/task", status: "pending" } });
    expect(findTask(directory, task.id)?.teamPickup).toEqual(task.teamPickup);
    expect(isTaskReadyForAgent({ ...task, stage: undefined })).toBe(false);
    for (const patch of [{ done: true }, { stage: "ready" as const }, { status: "reactivate" as const }, { text: "Changed" }]) {
      expect(() => patchTask(directory, task.id, patch)).toThrow("read-only");
    }
    expect(() => deleteTask(directory, task.id)).toThrow("read-only");
    expect(() => startTimer(directory, task.id)).toThrow("read-only");
  });
  it.each(["pending", "accepted"] as const)("persists the handoff and rejects ordinary task mutations (%s)", (status) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-team-ownership-")); roots.push(directory);
    const task = createTask(directory, { text: "APP-1 Fix the task" });
    writeItem(directory, { ...task, handoff: { handoffId: "h1", toUserId: "U2", toName: "helper", status, expiresAt: Date.now() + 1000 } });
    const saved = findTask(directory, task.id)!;
    expect(saved.handoff?.status).toBe(status);
    expect(isTaskReadyForAgent(saved)).toBe(false);
    expect(() => patchTask(directory, task.id, { done: true })).toThrow("read-only");
    expect(() => deleteTask(directory, task.id)).toThrow("read-only");
    expect(() => startTimer(directory, task.id)).toThrow("read-only");
  });
  it("emits future Needs-you only for the receiver's task", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-team-needs-")); roots.push(directory);
    const task = createTask(directory, { text: "APP-1 Fix the task" });
    const base: BoardCard = { taskId: task.id, date: task.startDate, title: task.text, status: "needs-you", taskDone: false, notePath: "task-notes/task", noteHref: "/notes/task-notes/task", task, tags: [], links: [], models: [], summary: [], counts: { openQuestions: 1, openBugs: 0, blockerBugs: 0, decisions: 0 }, screenshot: null, images: [], jev: null, tiers: null, run: null, steps: [], updatedAt: task.createdAt, attention: null };
    const presentation = { status: "Waiting for an answer", needsYou: true, action: { kind: "answer" as const, label: "Answer", href: "/work" } };
    const questions = () => ({ closed: false, questions: [{ id: "q1", text: "Keep it?", kind: "note" as const }] });
    const owner = { ...base, task: { ...task, handoff: { handoffId: "h1", toUserId: "U2", toName: "helper", status: "accepted" as const, expiresAt: 1 } } };
    expect(slackNeedsFromHome("work", [{ kind: "task", card: owner, presentation }], questions)).toEqual([]);
    const pickup = { ...base, task: { ...task, teamPickup: { handoffId: "h1", cwd: "/kept/worktree", branch: "feature/task", status: "pending" as const } } };
    expect(slackNeedsFromHome("work", [{ kind: "task", card: pickup, presentation }], questions)).toEqual([]);
    expect(slackNeedsFromHome("work", [{ kind: "task", card: base, presentation }], questions)).toHaveLength(1);
    expect(isTaskReadyForAgent(task)).toBe(true);
  });
});

