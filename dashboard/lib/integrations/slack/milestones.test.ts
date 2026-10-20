import { describe, expect, it } from "vitest";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { slackMilestonesFromCards } from "./milestones";

const now = Date.parse("2026-10-18T12:00:00Z");
function card(patch: Partial<BoardCard> = {}): BoardCard {
  return { taskId: "t1", title: "Fix ads", jira: ["PTF-1"], date: "2026-10-18", status: "in-progress", taskDone: false, notePath: null, noteHref: null, tags: [], links: [], models: [], summary: [], counts: { openQuestions: 0, openBugs: 0, blockerBugs: 0, decisions: 0 }, screenshot: null, images: [], jev: null, tiers: null, run: null, steps: [], updatedAt: new Date(now).toISOString(), attention: null, ...patch };
}

describe("agent milestone extraction", () => {
  it("finds a finished plan even if implementation started before the tick", () => {
    const milestones = slackMilestonesFromCards("work", [card({ steps: [{ runId: "i1", role: "implement", status: "running" }, { runId: "p1", role: "plan", status: "done" }] })], now);
    expect(milestones).toEqual([expect.objectContaining({ kind: "plan-ready", runId: "p1", taskId: "t1", title: "PTF-1 · Fix ads" })]);
    expect(slackMilestonesFromCards("work", [card({ steps: [{ runId: "p1", role: "plan", status: "running" }] })], now)).toEqual([]);
  });

  it("extracts PRs, failures and questions with stable per-run keys", () => {
    const input = card({ prUrl: "https://github.com/org/repo/pull/1", steps: [{ runId: "i1", role: "implement", status: "failed" }], auto: { phase: "implement", label: "Implement", round: 1, maxRounds: 3, waiting: { kind: "questions", reason: "Which repo?" } } });
    const milestones = slackMilestonesFromCards("work", [input], now);
    expect(milestones.map((item) => item.kind)).toEqual(["pr-opened", "failed", "needs-input"]);
    expect(milestones[0]).toMatchObject({ url: input.prUrl, runId: "i1" });
    expect(milestones[2].detail).toBe("Which repo?");
    expect(slackMilestonesFromCards("work", [input], now + 1000).map((item) => item.key)).toEqual(milestones.map((item) => item.key));
    expect(slackMilestonesFromCards("personal", [input], now)[0].key).not.toBe(milestones[0].key);
    expect(slackMilestonesFromCards("work", [{ ...input, steps: [{ runId: "i2", role: "implement", status: "failed" }] }], now)[1].key).not.toBe(milestones[1].key);
  });

  it("announces a waiting state only when it has something to say", () => {
    const awaiting = { reason: "awaiting" as const, label: "Waiting on you", action: { kind: "open" as const, label: "Answer" as const, href: "/x" } };
    expect(slackMilestonesFromCards("work", [card({ attention: awaiting })], now)).toEqual([]);
    expect(slackMilestonesFromCards("work", [card({ attention: awaiting, counts: { openQuestions: 2, openBugs: 0, blockerBugs: 0, decisions: 0 } })], now)).toEqual([expect.objectContaining({ kind: "needs-input", detail: "2 open questions." })]);
  });

  it("carries what the plan changed so Plan ready isn't just 'finished'", () => {
    const steps = [{ runId: "p1", role: "plan" as const, status: "done" as const }];
    expect(slackMilestonesFromCards("work", [card({ steps, summary: ["Add the games consent screen"] })], now)[0].detail).toBe("Add the games consent screen");
    expect(slackMilestonesFromCards("work", [card({ steps })], now)[0].detail).toBeUndefined();
  });

  it("reports an auto-mode cap as a failure without an agent run", () => {
    const [milestone] = slackMilestonesFromCards("work", [card({ auto: { phase: "fix", label: "Fix", round: 3, maxRounds: 3, waiting: { kind: "cap", reason: "Fix limit reached" } } })], now);
    expect(milestone).toMatchObject({ kind: "failed", runId: "auto", detail: "Fix limit reached" });
  });

  it("ignores old, completed and abandoned tasks and closed PRs", () => {
    const input = card({ steps: [{ runId: "p1", role: "plan", status: "done" }] });
    expect(slackMilestonesFromCards("work", [{ ...input, taskDone: true }], now)).toEqual([]);
    expect(slackMilestonesFromCards("work", [{ ...input, task: { id: "t1", text: "T", done: false, startDate: "2026-10-18", rank: "a", createdAt: new Date(now).toISOString(), abandonedAt: new Date(now).toISOString() } }], now)).toEqual([]);
    expect(slackMilestonesFromCards("work", [input], now + 25 * 60 * 60 * 1000)).toEqual([]);
    for (const prState of ["merged", "closed"] as const) expect(slackMilestonesFromCards("work", [card({ prUrl: "https://github.com/org/repo/pull/1", prState })], now)).toEqual([]);
  });

  it("announces work that is ready for review once per PR, with what a review request needs", () => {
    const input = card({ status: "ready-for-review", repo: "acme/app", prUrl: "https://github.com/acme/app/pull/9", steps: [{ runId: "i1", role: "implement", status: "done" }] });
    const [ready] = slackMilestonesFromCards("work", [input], now).filter((item) => item.kind === "ready-for-review");
    expect(ready).toMatchObject({ runId: "i1", url: input.prUrl, repo: "acme/app", jira: ["PTF-1"] });
    expect(slackMilestonesFromCards("work", [{ ...input, prState: "merged" }], now).some((item) => item.kind === "ready-for-review")).toBe(false);
    expect(slackMilestonesFromCards("work", [{ ...input, prUrl: "https://github.com/acme/app/pull/10" }], now).find((item) => item.kind === "ready-for-review")!.key).not.toBe(ready!.key);
  });

  it("announces one PR once, even when more implement runs appear for it", () => {
    const url = "https://github.com/acme/app/pull/9";
    const first = slackMilestonesFromCards("work", [card({ prUrl: url, steps: [{ runId: "i1", role: "implement", status: "done" }] })], now).find((item) => item.kind === "pr-opened")!;
    const later = slackMilestonesFromCards("work", [card({ prUrl: url, steps: [{ runId: "i2", role: "implement", status: "done" }, { runId: "i1", role: "implement", status: "done" }] })], now).find((item) => item.kind === "pr-opened")!;
    expect(later.key).toBe(first.key);
  });
});
