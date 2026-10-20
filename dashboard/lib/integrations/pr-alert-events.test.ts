import { describe, expect, it } from "vitest";
import type { AgentRun } from "@/lib/agent-runs/store";
import type { AutoPrReviewRecord } from "@/lib/github/auto-pr-review-state";
import type { GithubPrRow } from "@/lib/github/prs";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import type { TaskWorkflow } from "@/lib/workflows/types";
import { prAlertEvents } from "./pr-alert-events";

const now = Date.parse("2026-10-20T12:00:00Z");
const at = new Date(now - 1000).toISOString();
const pr: GithubPrRow = { url: "https://github.com/org/repo/pull/12", repo: "org/repo", number: 12, title: "The real PR title", draft: false, createdAt: at };
const record: AutoPrReviewRecord = { ...pr, updatedAt: at, startedAt: at, runId: "review1", workProfile: "work" };
function card(extra: Partial<BoardCard> = {}): BoardCard {
  return { taskId: "t1", title: "Private task title", status: "in-progress", taskDone: false, date: "2026-10-20", notePath: null, noteHref: null, tags: [], links: [], models: [], summary: [], counts: { openQuestions: 0, openBugs: 0, blockerBugs: 0, decisions: 0 }, screenshot: null, images: [], jev: null, tiers: null, run: null, steps: [{ runId: "implement1", role: "implement", status: "done" }], prUrl: pr.url, updatedAt: at, attention: null, jira: ["PTF-1234"], ...extra };
}
function run(extra: Partial<AgentRun["status"]> = {}): AgentRun {
  return { spec: { id: "review1", provider: "codex", providerLabel: "Codex", bin: "", args: [], format: "text", cwd: "/private/path", title: "Review", prompt: "secret", depth: 0, createdAt: now - 60000 }, dir: "/private/run", status: { state: "completed", updatedAt: now - 1000, finishedAt: now - 1000, eventCount: 1, resultText: "Verdict: looks good with 2 notes.\nDiff contains secret content", ...extra } };
}
function workflow(extra: Partial<TaskWorkflow> = {}): TaskWorkflow {
  return { version: 1, taskId: "t1", revision: 1, stage: "review", status: "active", checks: [], reviews: [], proposals: [], events: [{ id: "completion", at, summary: "review run: completed" }], seenRevision: 0, ...extra };
}
function events(extra: Partial<Parameters<typeof prAlertEvents>[0]> = {}) {
  return prAlertEvents({ profile: "work", cards: [], workflows: [], prs: [pr], autoReviews: [], readRun: () => run(), now, ...extra });
}

describe("PR event adapters", () => {
  it("announces automatic reviews only after successful completion in their launch profile", () => {
    expect(events({ autoReviews: [record] })).toEqual([expect.objectContaining({ id: "pr-reviewed:" + pr.url + ":review1", kind: "pr-reviewed", at, announcement: { url: pr.url, title: pr.title, verdict: "pass", notes: 2 } })]);
    for (const state of ["running", "failed", "cancelled", "needs-attention"] as const) expect(events({ autoReviews: [record], readRun: () => run({ state }) })).toEqual([]);
    expect(events({ autoReviews: [{ ...record, workProfile: "personal" }] })).toEqual([]);
    expect(events({ autoReviews: [{ ...record, workProfile: undefined }] })).toEqual([]);
    expect(events({ autoReviews: [{ ...record, runId: undefined, sessionId: "legacy" }] })).toEqual([]);
  });
  it("keys reviews by PR and run, regardless of title, and deduplicates task and auto sources", () => {
    const input = { cards: [card({ steps: [{ runId: "review1", role: "review", status: "done" }] })], workflows: [workflow()], autoReviews: [record] };
    const reviewed = events(input).filter((event) => event.kind === "pr-reviewed");
    expect(reviewed).toHaveLength(1);
    expect(events({ autoReviews: [{ ...record, title: "New title" }] })[0].id).toBe(reviewed[0].id);
    expect(events({ autoReviews: [{ ...record, runId: "review2" }] })[0].id).not.toBe(reviewed[0].id);
    expect(JSON.stringify(reviewed)).not.toMatch(/private|secret|Diff/);
  });
  it("uses the structured workflow verdict without copying findings", () => {
    const result = events({ cards: [card()], workflows: [workflow({ reviews: [{ runId: "review1", fingerprint: "", verdict: "changes-requested", findings: "secret diff", recordedAt: at }] })] });
    expect(result.find((event) => event.kind === "pr-reviewed")?.announcement?.verdict).toBe("changes-requested");
    expect(JSON.stringify(result)).not.toContain("secret diff");
  });
  it("uses milestone rules and actual PR metadata, with one key across opened and ready", () => {
    const opened = events({ cards: [card()] })[0];
    const ready = events({ cards: [card({ status: "ready-for-review", statusSetAt: at, steps: [{ runId: "retry2", role: "implement", status: "done" }] })] })[0];
    expect(opened).toMatchObject({ kind: "pr-ready", id: "pr-ready:" + pr.url, announcement: { title: pr.title, stage: "opened", jira: "PTF-1234" } });
    expect(ready.id).toBe(opened.id);
    expect(ready.announcement?.stage).toBe("ready");
    expect(events({ cards: [card(), card({ taskId: "t2" })] })).toHaveLength(1);
    expect(events({ cards: [card()], prs: [] })).toEqual([]);
    expect(events({ cards: [card()], prs: [{ ...pr, draft: undefined }] })).toEqual([]);
  });
  it("never announces draft, abandoned or done tasks, nor closed or draft PRs", () => {
    for (const extra of [{ taskDone: true }, { status: "done" as const }, { status: "draft-pr" as const }, { prState: "closed" as const }, { prState: "merged" as const }]) expect(events({ cards: [card(extra)] })).toEqual([]);
    const task = { id: "t1", text: "Task", done: false, startDate: "2026-10-20", rank: "a", createdAt: at };
    for (const extra of [{ stage: "draft" as const }, { abandonedAt: at }, { done: true }]) expect(events({ cards: [card({ task: { ...task, ...extra } })] })).toEqual([]);
    for (const extra of [{ draft: true }, { prState: "closed" as const }, { prState: "merged" as const }]) expect(events({ cards: [card()], autoReviews: [record], prs: [{ ...pr, ...extra }] })).toEqual([]);
  });
  it("ignores history on first connect, including an old PR on a recently edited card", () => {
    const old = new Date(now - 25 * 3600000).toISOString();
    expect(events({ autoReviews: [record], readRun: () => run({ finishedAt: Date.parse(old) }) })).toEqual([]);
    expect(events({ cards: [card()], prs: [{ ...pr, createdAt: old }] })).toEqual([]);
    expect(events({ cards: [card({ status: "ready-for-review", statusSetAt: old })] })).toEqual([]);
    expect(events({ cards: [card({ updatedAt: old })] })).toEqual([]);
  });
});
