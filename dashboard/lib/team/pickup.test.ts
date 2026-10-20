import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, findTask, patchTask } from "@shared/tasks/store.ts";
import { isTaskReadyForAgent } from "@shared/tasks/types.ts";
import { updateTaskNoteSections } from "@/lib/tasks/task-note-sections";
import { slackTaskQuestions } from "@/lib/integrations/slack/needs-you-source";
import { teamDependencies } from "./dependencies";
import type { TeamBundle } from "./store";

const scope = vi.hoisted(() => ({ tasks: "", notes: new Map<string, { content: unknown; modified: number }>() }));
vi.mock("@/lib/storage-server", () => ({ getStorage: () => ({ read: (notePath: string) => scope.notes.get(notePath) ?? null, write: (notePath: string, content: unknown) => scope.notes.set(notePath, { content, modified: Date.now() }) }) }));
vi.mock("@/lib/content/dirs", async (original) => ({ ...await original<typeof import("@/lib/content/dirs")>(), getActiveTasksDir: () => scope.tasks }));
vi.mock("@/lib/integrations/slack/answers", async (original) => ({ ...await original<typeof import("@/lib/integrations/slack/answers")>(), withSlackProfile: (_profile: string, work: () => unknown) => work() }));

const bundle: TeamBundle = { version: 1, handoffId: "00000000-1111-4222-8333-444444444444", title: "APP-1 Imported task", repo: "github.com/org/app", branch: "feature/task", jiraKey: "APP-1", reassignJira: false };
let root: string;
let checkout: { cwd: string; branch: string };
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-pickup-"));
  scope.tasks = path.join(root, "tasks");
  scope.notes.clear();
  checkout = { cwd: path.join(root, "worktree"), branch: bundle.branch };
  fs.mkdirSync(checkout.cwd);
  fs.writeFileSync(path.join(checkout.cwd, "kept.txt"), "Keep this work");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("pickup task persistence", () => {
  it("imports the open question without making the pending task actionable", () => {
    const task = teamDependencies.createPickup(bundle, "work", checkout);
    teamDependencies.writeNote(task, "work", "Summary: Continue the fix\n\nQuestion: Keep the last result?");
    const view = updateTaskNoteSections({ taskId: task.id }, { op: "read" }).view;
    expect(view.questions[0].text).toBe("Keep the last result?");
    expect(slackTaskQuestions("work", task.id)).toEqual({ closed: true, questions: [] });
    expect(findTask(scope.tasks, task.id)?.teamPickup?.status).toBe("pending");
  });
  it("creates a guarded pickup with its checkout and blocks note writes and Needs-you", () => {
    const task = teamDependencies.createPickup(bundle, "work", checkout);
    const saved = findTask(scope.tasks, task.id)!;
    expect(saved.teamPickup).toEqual({ handoffId: bundle.handoffId, ...checkout, status: "pending" });
    expect(isTaskReadyForAgent({ ...saved, stage: undefined })).toBe(false);
    expect(() => updateTaskNoteSections({ taskId: task.id }, { op: "set_status", status: "in-progress" })).toThrow("read-only");
    expect(slackTaskQuestions("work", task.id)).toEqual({ closed: true, questions: [] });
  });
  it("guards a saved legacy pickup before checking its receipt", () => {
    const task = createTask(scope.tasks, { id: bundle.handoffId, text: bundle.title, stage: "draft" });
    teamDependencies.holdPickup(task.id, "work", bundle.handoffId, checkout);
    expect(findTask(scope.tasks, task.id)?.teamPickup?.status).toBe("pending");
    expect(() => patchTask(scope.tasks, task.id, { stage: "ready" })).toThrow("read-only");
  });
  it("clears pending ownership only when finishing an accepted pickup", () => {
    const task = teamDependencies.createPickup(bundle, "work", checkout);
    teamDependencies.finishPickup(task.id, "work", bundle, checkout);
    const saved = findTask(scope.tasks, task.id)!;
    expect(saved.teamPickup).toEqual({ handoffId: bundle.handoffId, ...checkout });
    expect(isTaskReadyForAgent(saved)).toBe(true);
  });
  it("retires a rejected pickup without changing its worktree or enabling reactivation", () => {
    const task = teamDependencies.createPickup(bundle, "work", checkout);
    teamDependencies.retirePickup(task.id, "work");
    const saved = findTask(scope.tasks, task.id)!;
    expect(saved.abandonedAt).toBeTruthy();
    expect(saved.endDate).toBeTruthy();
    expect(saved.abandonReason).toBe("Handoff was declined/expired");
    expect(saved.teamPickup?.status).toBe("pending");
    expect(() => patchTask(scope.tasks, task.id, { status: "reactivate" })).toThrow("read-only");
    expect(fs.readFileSync(path.join(checkout.cwd, "kept.txt"), "utf8")).toBe("Keep this work");
  });
});
