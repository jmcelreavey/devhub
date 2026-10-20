import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, patchTask, writeItem } from "@shared/tasks/store.ts";
import { loadGithubPrsList } from "@/lib/github/prs-list";
import { listOwnedRepos } from "@/lib/ownership/owned-repos";
import { resolveLocalGithubRepos, type ResolvedLocalRepo } from "@/lib/repos/resolution";
import { answerRepoQuestion, decideOrchestrationPlan, retryOrchestration } from "@/lib/storyboard/orchestrator";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { readTaskNoteMarkdown } from "@/lib/tasks/implement-ready-gather";
import { mutateOrchestration, newOrchestration } from "@/lib/storyboard/orchestration-store";
import { updateTaskNoteSections } from "@/lib/tasks/task-note-sections";
import * as taskNoteSections from "@/lib/tasks/task-note-sections";
import { getActiveTasksDir } from "@/lib/content/dirs";
import { homeWorkSummary } from "@/lib/storyboard/home-summary";
import { answerSlackTask, decideSlackPlan, loadSlackNeedsSnapshot, retrySlackTask, slackNeedsFromHome, slackTaskQuestions } from "./needs-you-source";
import * as slackAnswers from "./answers";
import { loadSlackSnapshot, withSlackProfile } from "./answers";
import { resumeTaskAgent } from "@/lib/tasks/resume-task-agent";
vi.mock("@/lib/tasks/resume-task-agent", () => ({ resumeTaskAgent: vi.fn(async () => ({})) }));

vi.mock("@/lib/github/prs-list", () => ({ loadGithubPrsList: vi.fn() }));
vi.mock("@/lib/ownership/owned-repos", () => ({ listOwnedRepos: vi.fn() }));
vi.mock("@/lib/repos/resolution", () => ({ resolveLocalGithubRepos: vi.fn() }));
vi.mock("@/lib/storyboard/orchestrator", () => ({ answerRepoQuestion: vi.fn(), retryOrchestration: vi.fn(), decideOrchestrationPlan: vi.fn() }));
vi.mock("@/lib/tasks/implement-ready-gather", async (original) => ({ ...await original<typeof import("@/lib/tasks/implement-ready-gather")>(), readTaskNoteMarkdown: vi.fn() }));

let root: string;
let tasks: string;
let notes: string;
const date = "2026-10-18";

function taskWithQuestions(profile: string, prompts: string[]) {
  const task = createTask(path.join(tasks, profile), { text: "PTF-5135 · Feed fallback", startDate: date });
  withSlackProfile(profile, () => { for (const text of prompts) updateTaskNoteSections({ taskId: task.id }, { op: "add_question", text }); });
  return task;
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "slack-source-")));
  tasks = path.join(root, "tasks"); notes = path.join(root, "notes");
  fs.mkdirSync(path.join(tasks, "work"), { recursive: true }); fs.mkdirSync(path.join(tasks, "personal"), { recursive: true });
  vi.stubEnv("TASKS_DIR", tasks); vi.stubEnv("NOTES_DIR", notes); vi.stubEnv("REPO_ROOT", root);
  vi.stubEnv("DEVHUB_CONFIG_DIR", path.join(root, "config")); vi.stubEnv("DEVHUB_PROFILE", "personal");
  vi.clearAllMocks();
  vi.mocked(readTaskNoteMarkdown).mockReturnValue(null);
  vi.mocked(loadGithubPrsList).mockResolvedValue({ configured: false, authored: [], reviews: [], recentlyReviewed: [] });
  vi.mocked(listOwnedRepos).mockReturnValue([]);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

describe("Slack answers use the existing task-note write path", () => {
  it("carries question options into Slack cards and fingerprints changes to them", () => {
    const task = taskWithQuestions("work", ["Which env? Options: dev | prod"]);
    const questions = slackTaskQuestions("work", task.id);
    expect(questions.questions[0]).toMatchObject({ text: "Which env?", options: ["dev", "prod"] });
    const entries = [{ kind: "task", card: { taskId: task.id, title: task.text }, presentation: { status: "Question", action: { kind: "answer" } } }] as unknown as Parameters<typeof slackNeedsFromHome>[1];
    const first = slackNeedsFromHome("work", entries, () => questions)[0];
    const changed = slackNeedsFromHome("work", entries, () => ({ ...questions, questions: [{ ...questions.questions[0], options: ["dev", "sandbox"] }] }))[0];
    expect(first.options).toEqual(["dev", "prod"]);
    expect(changed.itemKey).not.toBe(first.itemKey);
  });

  it("resumes a failed manual task rather than sending it to auto mode", async () => {
    const task = createTask(path.join(tasks, "work"), { text: "Workflow run failed", startDate: date });
    await retrySlackTask("work", task.id, "token");
    expect(resumeTaskAgent).toHaveBeenCalledWith(expect.objectContaining({ taskId: task.id, date }));
    expect(retryOrchestration).not.toHaveBeenCalled();
  });
  it("offers retry, not Plan/Implement, for workflow failures", () => {
    const entries = [{ kind: "task", card: { taskId: "t1", title: "Failed task" }, presentation: { status: "Workflow run failed", action: { kind: "review" } } }] as unknown as Parameters<typeof slackNeedsFromHome>[1];
    expect(slackNeedsFromHome("work", entries)[0]).toMatchObject({ taskId: "t1", action: "retry" });
  });
  it("resolves the oldest unanswered question verbatim in the thread's profile, not the active one", async () => {
    const work = taskWithQuestions("work", ["Keep the previous result?", "Should this be logged?"]);
    const personal = taskWithQuestions("personal", ["A private question"]);
    const before = slackTaskQuestions("work", work.id).questions;
    const answer = "Keep it exactly as-is.\nDon't add a retry.";
    const update = vi.spyOn(taskNoteSections, "updateTaskNoteSections");
    const result = await answerSlackTask("work", work.id, answer, "event-1");
    expect(result).toMatchObject({ question: { id: before[0].id, text: before[0].text }, remaining: 1 });
    expect(update).toHaveBeenCalledWith({ taskId: work.id }, { op: "resolve_question", id: before[0].id, answer });
    const view = withSlackProfile("work", () => updateTaskNoteSections({ taskId: work.id }, { op: "read" }).view);
    expect(view.questions[0]).toMatchObject({ answer: answer.replace(/\s+/g, " "), resolved: true });
    expect(view.questions[1].resolved).toBe(false);
    expect(slackTaskQuestions("personal", personal.id).questions).toHaveLength(1);
    expect(getActiveTasksDir()).toBe(path.join(tasks, "personal"));
    await answerSlackTask("work", work.id, "Log it", "event-2");
    expect(slackTaskQuestions("work", work.id).questions).toEqual([]);
    expect(answerRepoQuestion).not.toHaveBeenCalled(); expect(retryOrchestration).not.toHaveBeenCalled();
  });

  it("returns no question for completed or missing tasks and rejects unknown profiles", async () => {
    const task = taskWithQuestions("work", ["A question"]);
    patchTask(path.join(tasks, "work"), task.id, { done: true });
    expect(await answerSlackTask("work", task.id, "Late answer", "late-event")).toEqual({ remaining: 0 });
    expect(slackTaskQuestions("personal", task.id)).toEqual({ closed: true, questions: [] });
    expect(() => slackTaskQuestions("../../work", task.id)).toThrow("Unknown task profile");
  });

  it.each(["abandoned", "answered"])("leaves an %s task question untouched on a late reply", async (scenario) => {
    const task = taskWithQuestions("work", ["A question"]);
    if (scenario === "abandoned") patchTask(path.join(tasks, "work"), task.id, { status: "abandon" });
    else withSlackProfile("work", () => updateTaskNoteSections({ taskId: task.id }, { op: "resolve_question", id: slackTaskQuestions("work", task.id).questions[0].id, answer: "Already answered" }));
    expect(await answerSlackTask("work", task.id, "Late answer", "late-event")).toEqual({ remaining: 0 });
    const view = withSlackProfile("work", () => updateTaskNoteSections({ taskId: task.id }, { op: "read" }).view);
    expect(view.questions[0].answer).toBe(scenario === "answered" ? "Already answered" : undefined);
  });

  it.each(["", " ", "a".repeat(12001)])("rejects empty or oversized answers before writing", async (answer) => {
    const task = taskWithQuestions("work", ["Question?"]);
    await expect(answerSlackTask("work", task.id, answer, "event")).rejects.toThrow("12,000");
    expect(slackTaskQuestions("work", task.id).questions).toHaveLength(1);
  });

  it("routes repo answers through answerRepoQuestion with a recognised checkout and idempotency key", async () => {
    const task = createTask(path.join(tasks, "work"), { text: "Choose a repo", startDate: date });
    const orchestration = newOrchestration({ taskId: task.id, taskDate: date });
    orchestration.status = "needs-you";
    orchestration.questions = [{ id: "repo", kind: "repo", stepId: "plan", state: "open", prompt: "Which repo?", askedAt: "2026-10-18T12:00:00Z" }];
    await mutateOrchestration(task.id, null, () => orchestration, notes);
    vi.mocked(resolveLocalGithubRepos).mockResolvedValue([{ fullName: "acme/app", repo: { name: "app", path: "/Users/test/app" } } as ResolvedLocalRepo]);
    vi.mocked(answerRepoQuestion).mockImplementation(async () => {
      await mutateOrchestration(task.id, null, (current) => { current!.questions[0].state = "answered"; return current; }, notes);
      return { orchestration, created: false, replayed: false, runId: null, dispatchError: null };
    });
    expect(await answerSlackTask("work", task.id, "acme/app", "repo-event")).toMatchObject({ question: { id: "repo", kind: "repo" }, remaining: 0 });
    expect(answerRepoQuestion).toHaveBeenCalledExactlyOnceWith({ action: "answer-repo", taskId: task.id, taskDate: date, cwd: "/Users/test/app", idempotencyKey: expect.stringMatching(/^slack-[a-f0-9]{64}$/) }, expect.objectContaining({ origin: expect.stringMatching(/^https?:/) }));
  });

  it("doesn't guess ambiguous repos or treat arbitrary text as a folder", async () => {
    const task = createTask(path.join(tasks, "work"), { text: "Choose a repo", startDate: date });
    const record = newOrchestration({ taskId: task.id, taskDate: date });
    record.questions = [{ id: "repo", kind: "repo", stepId: "plan", state: "open", prompt: "Which repo?", askedAt: "2026-10-18T12:00:00Z" }];
    await mutateOrchestration(task.id, null, () => record, notes);
    vi.mocked(resolveLocalGithubRepos).mockResolvedValue(["one", "two"].map((owner) => ({ fullName: `${owner}/app`, repo: { name: "app", path: `/Users/test/${owner}/app` } } as ResolvedLocalRepo)));
    await expect(answerSlackTask("work", task.id, "app", "event")).rejects.toThrow("one recognised repo");
    await expect(answerSlackTask("work", task.id, "../private", "event")).rejects.toThrow("one recognised repo");
    expect(answerRepoQuestion).not.toHaveBeenCalled();
  });

  it("retries through the orchestrator and executes its returned work, scoped to the recorded profile", async () => {
    const task = createTask(path.join(tasks, "work"), { text: "Retry me", startDate: date });
    await mutateOrchestration(task.id, null, () => newOrchestration({ taskId: task.id, taskDate: date }), notes);
    const execute = vi.fn(async () => {});
    vi.mocked(retryOrchestration).mockImplementation(async () => {
      expect(getActiveTasksDir()).toBe(path.join(tasks, "work"));
      return { orchestration: newOrchestration({ taskId: task.id, taskDate: date }), execute };
    });
    await retrySlackTask("work", task.id, "confirmation-token");
    expect(retryOrchestration).toHaveBeenCalledWith({ action: "retry", taskId: task.id, idempotencyKey: "slack-confirmation-token" }, expect.any(Object));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(getActiveTasksDir()).toBe(path.join(tasks, "personal"));
    await expect(retrySlackTask("personal", task.id, "wrong-profile")).rejects.toThrow("no longer open");
    expect(retryOrchestration).toHaveBeenCalledTimes(1);
  });
});

describe("Slack shares Home's Needs you resolver and sources", () => {
  it("recognises the real Reopen-and-address-feedback push-failure question without changing its answer path", async () => {
    const task = taskWithQuestions("work", ["Push failed: pre-push hook rejected the branch. Leave the commit in place."]);
    const snapshot = await loadSlackNeedsSnapshot("work");
    expect(snapshot.items).toEqual([expect.objectContaining({ taskId: task.id, state: "push-failed", action: "answer", needed: expect.stringContaining("Push failed:") })]);
  });
  function card(patch: Partial<BoardCard> = {}): BoardCard {
    const task = createTask(path.join(tasks, "work"), { text: "APP-42 · Keep saved articles available offline", startDate: date });
    const found = loadSlackSnapshot("work").cards.find((entry) => entry.taskId === task.id)!;
    return { ...found, notePath: "fixture-plan", noteHref: "/notes/fixture-plan", status: "needs-you", ...patch };
  }
  const planAuto: BoardCard["auto"] = { phase: "plan", label: "Plan", round: 0, maxRounds: 2, status: "needs-you", planRunId: "run-plan-one", waiting: { kind: "plan-approval", reason: "Plan ready" } };
  function needs(value: BoardCard) {
    const home = homeWorkSummary([value], [], [], Date.now());
    return slackNeedsFromHome("work", home["needs-you"], () => ({ closed: false, questions: [{ id: "question-one", text: "Cache images too?", kind: "note" }] }));
  }

  it.each([
    ["plan-ready", { auto: planAuto }],
    ["question", { counts: { openQuestions: 1, openBugs: 0, blockerBugs: 0, decisions: 0 } }],
    ["failed-run", { failure: { key: "failed-one", summary: "Run failed: provider unavailable" } }],
    ["review-ready", { review: { runId: "review-one", gist: "AI review ready", notes: "Check the cache timeout" } }],
    ["finished-feedback", { taskDone: true, finishedFeedback: { key: "feedback-one", summary: "Please fix the test", brief: "Review comment", action: "reopen-feedback" } }],
    ["push-failed", { failure: { key: "push-one", summary: "Push failed: remote rejected the update" } }],
  ] satisfies Array<[string, Partial<BoardCard>]>)("projects the real Home %s state with a stable fingerprint", (state, patch) => {
    const value = card(patch); const first = needs(value)[0];
    expect(first).toMatchObject({ state, taskId: value.taskId });
    expect(needs({ ...value, updatedAt: new Date().toISOString() })[0].itemKey).toBe(first.itemKey);
  });

  it("fingerprints full plan contents and run while using an AI summary or five plan lines for the preview", () => {
    vi.mocked(readTaskNoteMarkdown).mockReturnValue("## Plan\nFirst line\nSecond line\nThird line\nFourth line\nFifth line\nSixth line\n## Acceptance\nMust work");
    const value = card({ auto: planAuto, summary: [] }); const first = needs(value)[0];
    expect(first.action).toBe("approve-plan"); expect(first.plan?.summary).toBe("First line\nSecond line\nThird line\nFourth line\nFifth line");
    expect(needs({ ...value, summary: ["AI summary"] })[0].plan?.summary).toBe("AI summary");
    vi.mocked(readTaskNoteMarkdown).mockReturnValue("## Plan\nRevised cache strategy");
    expect(needs(value)[0].itemKey).not.toBe(first.itemKey);
    expect(needs({ ...value, auto: { ...planAuto!, planRunId: "run-plan-two" } })[0].plan?.fingerprint).not.toBe(first.plan?.fingerprint);
  });

  it("notices new review evidence and finished feedback even when the displayed gist is unchanged", () => {
    const reviewed = card({ review: { runId: "review-one", gist: "Review ready", notes: "Original findings" } });
    expect(needs({ ...reviewed, review: { ...reviewed.review!, notes: "New findings" } })[0].itemKey).not.toBe(needs(reviewed)[0].itemKey);
    const finished = card({ taskDone: true, finishedFeedback: { key: "one", action: "reopen-feedback", summary: "Please fix", brief: "Please fix" } });
    expect(needs({ ...finished, finishedFeedback: { ...finished.finishedFeedback!, key: "two" } })[0].itemKey).not.toBe(needs(finished)[0].itemKey);
  });

  it.each(["approve", "revise"] as const)("calls the dashboard's existing %s path and executes returned work exactly once", async (decision) => {
    vi.mocked(readTaskNoteMarkdown).mockReturnValue("## Plan\nCache saved articles locally");
    const value = card({ auto: planAuto }); const plan = needs(value)[0].plan!;
    vi.spyOn(slackAnswers, "loadSlackSnapshot").mockReturnValue({ cards: [value], items: [], todayTaskIds: [], errors: [] });
    const execute = vi.fn(async () => {});
    vi.mocked(decideOrchestrationPlan).mockResolvedValue({ orchestration: newOrchestration({ taskId: value.taskId, taskDate: date }), execute });
    await decideSlackPlan("work", value.taskId, plan, decision, "plan-token", decision === "revise" ? "Keep it local" : undefined);
    expect(decideOrchestrationPlan).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: "plan-decision", taskId: value.taskId, planRunId: plan.runId, decision, ...(decision === "revise" ? { guidance: "Keep it local" } : {}) }));
    expect(execute).toHaveBeenCalledTimes(1); expect(getActiveTasksDir()).toBe(path.join(tasks, "personal"));
  });

  it("refuses stale plan text before reaching the approve path", async () => {
    vi.mocked(readTaskNoteMarkdown).mockReturnValue("## Plan\nOriginal plan");
    const value = card({ auto: planAuto }); const plan = needs(value)[0].plan!;
    vi.spyOn(slackAnswers, "loadSlackSnapshot").mockReturnValue({ cards: [value], items: [], todayTaskIds: [], errors: [] });
    vi.mocked(readTaskNoteMarkdown).mockReturnValue("## Plan\nNew plan in the same run");
    await expect(decideSlackPlan("work", value.taskId, plan, "approve", "token")).rejects.toThrow("plan changed");
    expect(decideOrchestrationPlan).not.toHaveBeenCalled();
  });

  it.each(["pending", "accepted", "pickup"])("excludes %s handoffs and pickup tasks from Slack needs and plan writes", async (state) => {
    const value = card({ auto: planAuto });
    const ownership = state === "pickup" ? { teamPickup: { handoffId: "handoff", cwd: "/tmp/app", branch: "feature", status: "pending" as const } }
      : { handoff: { handoffId: "handoff", toUserId: "UTEAMMATE", toName: "Teammate", status: state as "pending" | "accepted", expiresAt: Date.now() + 60000 } };
    writeItem(path.join(tasks, "work"), { ...value.task!, ...ownership });
    const blocked = { ...value, task: { ...value.task!, ...ownership } };
    expect(needs(blocked)).toEqual([]);
    const plan = { runId: "run-one", fingerprint: "one", summary: "Plan" };
    await expect(decideSlackPlan("work", value.taskId, plan, "approve", "token")).rejects.toThrow("no longer yours");
  });
  it("includes plugin attention alongside the same board's task needs", async () => {
    const task = taskWithQuestions("work", ["Which repo?"]);
    const pluginNeed = { profile: "work", entityId: "plugin:fake:1", title: "Fake plugin needs you", needed: "Review report", href: "/fake", action: "open" as const, itemKey: "fake" };
    const pluginNeeds = vi.fn(() => [pluginNeed]);
    const snapshot = await loadSlackNeedsSnapshot("work", loadSlackSnapshot("work"), pluginNeeds);
    expect(snapshot.items).toEqual(expect.arrayContaining([expect.objectContaining({ taskId: task.id }), pluginNeed]));
    expect(pluginNeeds).toHaveBeenCalledExactlyOnceWith("work");
  });
  it("uses real board statuses, task identity and individual questions without duplicating Jira keys", async () => {
    const task = taskWithQuestions("work", ["Keep it?", "Log it?"]);
    const snapshot = await loadSlackNeedsSnapshot("work");
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items.map((item) => item.questionId)).toEqual(slackTaskQuestions("work", task.id).questions.map((question) => question.id));
    expect(snapshot.items[0]).toMatchObject({ taskId: task.id, jiraKey: "PTF-5135", title: "PTF-5135 · Feed fallback", action: "answer", profile: "work" });
    expect(new URL(snapshot.items[0].href, "http://localhost").searchParams).toEqual(new URLSearchParams({ taskProfile: "work", task: task.id, taskSection: "answer" }));
    const board = loadSlackSnapshot("work");
    const home = homeWorkSummary(board.cards, board.items, [], Date.now());
    expect(new Set(snapshot.items.map((item) => item.entityId))).toEqual(new Set(home["needs-you"].map((item) => item.kind === "task" ? `task:${item.card.taskId}` : "")));
  });

  it("inherits Home's owned-repo peer-review rule and keeps own actionable PRs", async () => {
    const pr = (number: number, repo: string) => ({ number, repo, title: `Review ${number}`, url: `https://github.com/${repo}/pull/${number}` });
    vi.mocked(loadGithubPrsList).mockResolvedValue({ configured: true, authored: [{ ...pr(3, "other/mine"), checks: "failing" }], reviews: [pr(1, "acme/app"), pr(2, "other/team"), pr(3, "other/mine")], recentlyReviewed: [] });
    vi.mocked(listOwnedRepos).mockReturnValue([{ fullName: "ACME/APP", name: "app", addedAt: "", lastVisited: null, lastSeenSha: null, domains: null, teams: null }]);
    const snapshot = await loadSlackNeedsSnapshot("work");
    expect(snapshot.items.map((item) => item.entityId)).toEqual(["prs:actionable"]);
    expect(snapshot.items[0].prRows?.[1].needed).toBe("Your PR has failing checks");
    expect(snapshot.items.every((item) => !item.taskId && item.action === "open")).toBe(true);
    expect(snapshot.items[0].prRows?.map((item) => item.href)).toEqual(["/?pr=acme%2Fapp%231&taskProfile=work", "/?pr=other%2Fmine%233&taskProfile=work"]);
  });

  it("doesn't manufacture a Jira key for keyless pending children", () => {
    const card = { taskId: "child", title: "Unfiled child", jira: undefined } as never;
    const result = slackNeedsFromHome("work", [{ kind: "task", card, presentation: { status: "Review ready", needsYou: true, action: { kind: "review", label: "Review", href: "/storyboard" } } }]);
    expect(result[0].title).toBe("Unfiled child");
    expect(result[0].jiraKey).toBeUndefined();
  });

  it("treats GitHub outages as unknown, not as resolved reviews", async () => {
    vi.mocked(loadGithubPrsList).mockRejectedValue(new Error("upstream"));
    expect(await loadSlackNeedsSnapshot("work")).toEqual({ items: [], peersKnown: false, milestones: [] });
    vi.mocked(loadGithubPrsList).mockResolvedValue({ configured: true, stale: true, authored: [], reviews: [], recentlyReviewed: [] });
    expect((await loadSlackNeedsSnapshot("work")).peersKnown).toBe(false);
  });
});
