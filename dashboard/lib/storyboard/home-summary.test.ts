import { describe, expect, it } from "vitest";
import type { BoardCard } from "./notes-board-shared";
import type { WorkflowInboxItem } from "@/lib/workflows/inbox";
import type { GithubPrRow } from "@/lib/github/prs";
import { homeNeedsAction, homeSectionHref, homeWorkKey, homeWorkSummary, sortHomeTaskRows } from "./home-summary";
import { prDetailHref, prDetailIdentity } from "./pr-detail";

const now = Date.parse("2026-10-18T12:00:00Z");
it("does not count plain tasks in the Home attention badge", () => {
  expect(homeNeedsAction(homeWorkSummary([card("plain")], [], [], now))).toEqual([]);
});
it("counts AI review rows alongside task actions, while peer reviews stay out of the Home badge", () => {
  const reviewed = card("reviewed", { review: { gist: "Fix the timeout test", notes: "Fix the timeout test", runId: "review" } });
  const summary = homeWorkSummary([reviewed, reviewed, card("plain")], [], [pr(1)], now, [], ["acme/app"]);
  expect(homeNeedsAction(summary).map(homeWorkKey)).toEqual(["task:reviewed"]);
  expect(homeNeedsAction(summary)[0].presentation.action?.label).toBe("Open review");
});
function card(taskId: string, patch: Partial<BoardCard> = {}): BoardCard {
  return { taskId, title: taskId, date: "2026-10-18", status: "todo", taskDone: false, notePath: `task-notes/${taskId}`, noteHref: `/notes/task-notes/${taskId}`, tags: [], links: [], models: [], summary: [], counts: { openQuestions: 0, openBugs: 0, blockerBugs: 0, decisions: 0 }, images: [], screenshot: null, jev: null, tiers: null, run: null, steps: [], attention: null, updatedAt: "2026-10-18T10:00:00Z", ...patch };
}
const pr = (number: number, patch: Partial<GithubPrRow> = {}): GithubPrRow => ({ number, title: `PR ${number}`, repo: "acme/app", url: `https://github.com/acme/app/pull/${number}`, ...patch });

it("counts new feedback on finished tasks in the same list used by the badge", () => {
  const finished = card("finished", { status: "done", taskDone: true, task: { id: "finished", text: "Finished", done: true, startDate: "2026-10-18", rank: "a", createdAt: "", completedAt: "2026-10-18T10:00:00Z" }, prUrl: "https://github.com/acme/app/pull/1" });
  const feedback = { url: finished.prUrl!, state: "OPEN", self: "john", activity: [{ author: "reviewer", at: "2026-10-18T11:00:00Z", body: "Please fix this" }], failedChecks: [] };
  const summary = homeWorkSummary([finished, finished], [], [], now, [], [], [feedback]);
  expect(homeNeedsAction(summary)).toHaveLength(1);
  expect(homeNeedsAction(summary)[0].presentation).toMatchObject({ status: expect.stringContaining("New feedback on a finished task"), action: { kind: "reopen-feedback" } });
  expect(summary.next).toEqual([]);
  expect(homeNeedsAction(homeWorkSummary([finished], [], [], now, [], [], [{ ...feedback, state: "MERGED" }]))[0].presentation.action?.kind).toBe("follow-up");
});
const pending = (taskId: string): WorkflowInboxItem => ({ task: { id: taskId, text: taskId, startDate: "2026-10-18", createdAt: "", done: false, rank: "a" }, workflow: { version: 1, taskId, stage: "draft-pr", status: "waiting-user", revision: 1, seenRevision: 1, checks: [], reviews: [], events: [], proposals: [{ id: "proposal", kind: "draft-pr", state: "pending", runId: "run", fingerprint: "abc", contentHash: "def", destination: "acme/app", content: "PR", expiresAt: "2027-01-01" }] } });

describe("Home's projection of the work summary", () => {
  it("gives Needs you precedence, deduplicates tasks and includes read publication decisions", () => {
    const question = card("question", { counts: { openQuestions: 1, openBugs: 0, blockerBugs: 0, decisions: 0 }, run: { runId: "r", status: "running", startedAt: "" } });
    const summary = homeWorkSummary([question, question, card("proposal"), card("review", { status: "ready-for-review" }), card("merged", { prState: "merged" }), card("next")], [pending("proposal"), pending("foreign")], [], now);
    expect(summary["needs-you"].map(homeWorkKey)).toEqual(["task:question", "task:proposal", "task:review", "task:merged"]);
    expect(summary.running).toEqual([]);
    expect(summary.next.map(homeWorkKey)).toEqual(["task:next"]);
    expect(new Set(Object.values(summary).flat().map(homeWorkKey)).size).toBe(5);
  });

  it("includes retryable failures and the fix cap without manufacturing Retry for an outside blocker", () => {
    const summary = homeWorkSummary([card("failed", { run: { runId: "r", status: "failed", startedAt: "" } }), card("cap", { auto: { status: "needs-you", phase: "fix", label: "Fix", round: 2, maxRounds: 2, waiting: { kind: "cap", reason: "Fix limit reached" } } }), card("external", { status: "blocked" })], [], [], now);
    expect(summary["needs-you"].map((work) => work.presentation.action?.label)).toEqual(expect.arrayContaining(["Retry", "One more round"]));
    expect(summary.next).toEqual([]);
    expect(summary.running).toEqual([]);
  });

  it("only calls actually queued/running work Running and shows the phase's last update", () => {
    const summary = homeWorkSummary([
      card("live", { auto: { status: "running", phase: "implement", label: "Build", round: 0, maxRounds: 2, updatedAt: "2026-10-18T11:59:00Z" } }),
      card("queued", { run: { runId: "r", status: "queued", startedAt: "", updatedAt: "2026-10-18T11:58:00Z" } }),
      card("paused", { status: "in-progress", run: { runId: "p", status: "paused", startedAt: "" } }),
      card("manual", { auto: { status: "paused-manual", phase: "implement", label: "Build", round: 0, maxRounds: 2 } }),
      card("blocked", { status: "blocked", run: { runId: "b", status: "running", startedAt: "" } }),
    ], [], [], now);
    expect(summary.running.map(homeWorkKey)).toEqual(["task:live", "task:queued"]);
    expect(summary.running[0].presentation).toMatchObject({ status: "Build · updated 1m ago", action: { kind: "progress", label: "View progress" } });
    expect(summary.running[1].presentation.status).toBe("Queued · updated 2m ago");
    expect(summary.next.map(homeWorkKey)).toEqual(["task:manual"]);
  });

  it("keeps John's note ranks, then task ranks, ahead of unranked work, without inferring manual from titles", () => {
    const summary = homeWorkSummary([card("last"), card("second", { rank: "b" }), card("first", { task: { id: "first", text: "Manual task", done: false, startDate: "2026-10-18", createdAt: "", rank: "a" } }), card("finished", { taskDone: true })], [], [], now);
    expect(summary.next.map(homeWorkKey)).toEqual(["task:first", "task:second", "task:last"]);
    expect(summary.next[0].presentation.action?.kind).toBe("start-auto");
  });

  it("uses PR identity, not fake task IDs; deduplicates requested reviews and excludes own/linked PRs", () => {
    const summary = homeWorkSummary([card("linked", { status: "ready-for-review", prUrl: pr(3).url })], [], [pr(1), pr(1, { repo: "ACME/APP" }), pr(2), pr(3), pr(4, { prState: "merged" })], now, [pr(2)], ["acme/app"]);
    expect(summary["needs-you"].map(homeWorkKey)).toEqual(["task:linked", "pr:acme/app#1"]);
    const peer = summary["needs-you"][1];
    expect(peer.kind).toBe("pr");
    expect(peer).not.toHaveProperty("card");
    expect(peer).not.toHaveProperty("taskId");
    expect(homeWorkSummary([card("unstarted", { prUrl: pr(1).url })], [], [pr(1)], now, [], ["acme/app"])["needs-you"].map(homeWorkKey)).toEqual(["pr:acme/app#1"]);
  });

  it("limits reviews to Owned repos but retains own PRs needing action", () => {
    const summary = homeWorkSummary([], [], [pr(1), pr(2, { repo: "team/other" })], now, [pr(3, { repo: "other/mine", checks: "failing" })], ["ACME/APP"]);
    expect(summary["needs-you"].map(homeWorkKey)).toEqual(["pr:acme/app#1", "pr:other/mine#3"]);
    expect(homeWorkSummary([], [], [pr(1)], now)["needs-you"]).toEqual([]);
  });

  it("ignores stale questions, failed runs and workflows on Done and deliberately reset To do cards", () => {
    const stale = { counts: { openQuestions: 1, openBugs: 0, blockerBugs: 0, decisions: 0 }, run: { runId: "old", status: "failed", startedAt: "" } };
    const summary = homeWorkSummary([
      card("jira-done", { ...stale, status: "done" }),
      card("reset", { ...stale, status: "todo", statusSetAt: "2026-10-18T11:00:00Z" }),
    ], [pending("jira-done"), pending("reset")], [], now);
    expect(summary["needs-you"].map((work) => [homeWorkKey(work), work.presentation.action?.label])).toEqual([["task:jira-done", "Finish"]]);
    expect(summary.next.map(homeWorkKey)).toEqual(["task:reset"]);
  });

  it("keeps full totals independent of a capped preview and links each section to the matching Storyboard filter", () => {
    const summary = homeWorkSummary(Array.from({ length: 7 }, (_, index) => card(`next-${index}`)), [], [], now);
    expect(summary.next.slice(0, 3)).toHaveLength(3);
    expect(summary.next).toHaveLength(7);
    for (const section of ["needs-you", "running", "next"] as const) {
      const url = new URL(homeSectionHref(section, "work"), "http://localhost");
      expect(url.pathname).toBe("/storyboard");
      expect(url.searchParams.has("view")).toBe(false);
      expect(url.searchParams.get("profile")).toBe("work");
      expect(url.searchParams.get(section === "needs-you" ? "attention" : "queue")).toBe(section);
    }
  });

  it("preserves detail query/hash state and rejects malformed PR identities", () => {
    const href = prDetailHref("/", "view=home&task=old&taskSection=answer", pr(42), "work", "#legacy");
    const url = new URL(href, "http://localhost");
    expect(url.searchParams.get("pr")).toBe("acme/app#42");
    expect(url.searchParams.get("taskProfile")).toBe("work");
    expect(url.searchParams.has("task")).toBe(false);
    expect(url.hash).toBe("#legacy");
    expect(prDetailIdentity("ACME/APP#42")).toBe("acme/app#42");
    for (const invalid of [null, "https://evil.test", "app#1", "a/b#0", "a/b#1/../../"]) expect(prDetailIdentity(invalid)).toBeNull();
  });
});

it("keeps acknowledged failures reachable in Next without automatically restarting them", () => {
  const summary = homeWorkSummary([card("cleared", { status: "in-progress", failure: { key: "failure", summary: "Timeout", cleared: true }, run: { runId: "failed", status: "failed", startedAt: "" } })], [], [], now);
  expect(summary.next.map(homeWorkKey)).toEqual(["task:cleared"]);
  expect(summary.next[0].presentation.action).toMatchObject({ kind: "progress", label: "View details" });
  expect(summary["needs-you"]).toEqual([]);
});

it("keeps finished work with an open PR on Home until the task is completed", () => {
  const finished = card("finish", { status: "done", prUrl: pr(1).url, prState: "open", run: { runId: "success", status: "done", startedAt: "" } });
  const summary = homeWorkSummary([finished], [], [], now);
  expect(summary["needs-you"].map((work) => [homeWorkKey(work), work.presentation.action?.label])).toEqual([["task:finish", "Finish"]]);
  expect(summary.next).toEqual([]);
  expect(summary.running).toEqual([]);
  expect(homeWorkSummary([{ ...finished, taskDone: true }], [], [], now)["needs-you"]).toEqual([]);
});

describe("sortHomeTaskRows", () => {
  const work = (taskId: string, patch: Partial<BoardCard> = {}): ReturnType<typeof homeWorkSummary>["next"][number] => ({
    kind: "task",
    card: card(taskId, patch),
    presentation: { status: taskId, needsYou: false, action: null },
  });

  it("puts needs action first, then running (newest first), then next, then the rest", () => {
    const ask = work("ask", { counts: { openQuestions: 1, openBugs: 0, blockerBugs: 0, decisions: 0 } });
    const olderRun = work("older-run", { status: "in-progress", auto: { status: "running", phase: "implement", label: "Build", round: 0, maxRounds: 2, updatedAt: "2026-10-18T11:00:00Z" } });
    const newerRun = work("newer-run", { status: "in-progress", run: { runId: "r", status: "running", startedAt: "", updatedAt: "2026-10-18T11:50:00Z" } });
    const boardInProgress = work("board-run", { status: "in-progress", updatedAt: "2026-10-18T11:40:00Z" });
    const nextHigh = work("next-high", { status: "todo", rank: "a" });
    const nextLow = work("next-low", { status: "todo", rank: "b" });
    const cleared = work("cleared", { status: "in-progress", failure: { key: "f", summary: "Timeout", cleared: true } });
    const paused = work("paused", { status: "in-progress", run: { runId: "p", status: "paused", startedAt: "" } });
    const sorted = sortHomeTaskRows(
      [nextHigh, olderRun, cleared, ask, nextLow, paused, newerRun, boardInProgress],
      new Set(["ask"]),
      new Set(["older-run", "newer-run"]),
      new Set(["next-high", "next-low", "cleared"]),
    );
    expect(sorted.map((row) => row.card.taskId)).toEqual([
      "ask",
      "newer-run",
      "board-run",
      "older-run",
      "next-high",
      "next-low",
      "cleared",
      "paused",
    ]);
  });

  it("keeps relative order inside needs-action and next groups", () => {
    const sorted = sortHomeTaskRows(
      [work("n2", { status: "todo" }), work("need-b"), work("n1", { status: "todo" }), work("need-a")],
      new Set(["need-a", "need-b"]),
      new Set(),
      new Set(["n1", "n2"]),
    );
    expect(sorted.map((row) => row.card.taskId)).toEqual(["need-b", "need-a", "n2", "n1"]);
  });
});
