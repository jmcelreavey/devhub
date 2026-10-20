import { describe, expect, it } from "vitest";
import { taskNoteMetaFence } from "@shared/task-note/meta.ts";
import { applyTaskNoteOp, readTaskNote, type TaskNoteOp } from "@shared/task-note/sections.ts";
import { textToBlocks } from "@shared/markdown-convert/index.ts";
import type { JevInfo } from "@/lib/qa/jev-summary";
import type { Task } from "@/lib/tasks/types";
import { resolveWorkPresentation } from "./work-summary";
import { DEFAULT_MODEL_TIERS } from "./model-tiers-shared";
import { buildNotesBoard, cardImages, imageBlocks, lastImageBlock, type BoardSources, type NoteRead } from "./notes-board";
import type { OrchestrationSummary } from "./orchestration";

const NOW = Date.parse("2026-10-17T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

it("keeps old finished tasks with new cached feedback visible without reopening them", () => {
  const url = "https://github.com/acme/app/pull/1";
  const finished = task("finished", { done: true, completedAt: new Date(NOW - 20 * DAY).toISOString(), links: [{ kind: "pr", id: url, label: "PR", href: url }] });
  const result = board([finished], {}, { feedbackPrs: [{ url, state: "MERGED", self: "john", activity: [{ author: "reviewer", at: new Date(NOW - DAY).toISOString(), body: "Please follow up" }], failedChecks: [] }] });
  expect(result.cards).toHaveLength(1);
  expect(result.cards[0]).toMatchObject({ taskDone: true, status: "done", prState: "merged", finishedFeedback: { action: "follow-up" } });
  expect(resolveWorkPresentation(result.cards[0], undefined, NOW).action?.kind).toBe("follow-up");
  expect(result.hiddenDone).toBe(0);
});

function task(id: string, patch: Partial<Task> = {}): Task {
  return { id, text: `Task ${id}`, done: false, startDate: "2026-10-10", rank: id, createdAt: "2026-10-10T09:00:00Z", ...patch };
}

function note(id: string, meta: object, ops: TaskNoteOp[] = []): NoteRead {
  let blocks = textToBlocks(`# Task ${id}\n\n${taskNoteMetaFence(meta)}\n`) as unknown[];
  for (const op of ops) blocks = applyTaskNoteOp(blocks, op).blocks;
  return { notePath: `task-notes/2026-10-10-${id}`, view: readTaskNote(blocks), modified: NOW - 1000 };
}

function board(tasks: Task[], notes: Record<string, NoteRead>, extra: Partial<BoardSources> = {}) {
  return buildNotesBoard({
    tasks,
    now: NOW,
    doneWindowDays: 14,
    noteFor: (t) => notes[t.id] ?? { notePath: `task-notes/2026-10-10-${t.id}`, view: null, modified: null },
    runsFor: () => [],
    orchestrations: new Map(),
    jev: new Map(),
    errors: [],
    ...extra,
  });
}

describe("buildNotesBoard", () => {
  it.each(["Code Review", "review", "IN REVIEW", "QA", "Done", "Closed", "Resolved"])("uses Jira %s as Done without completing the task", (status) => {
    const result = board([task("a", { jiraKey: "PTF-5271" })], { a: note("a", { status: "todo" }) }, {
      jiraStatusOf: (key) => key === "PTF-5271" ? { status } : undefined,
      runsFor: () => [{ runId: "old", status: "failed", startedAt: "" }],
      orchestrations: new Map([["a", { taskId: "a", taskDate: "2026-10-10", status: "needs-you", executionStep: "verify", openQuestions: 0, runCount: 1, updatedAt: "2026-10-16T10:00:00Z" }]]),
    });
    expect(result.cards[0]).toMatchObject({ status: "done", taskDone: false, task: { done: false }, attention: null });
    expect(result.columns.find((column) => column.status === "done")?.count).toBe(1);
  });

  it.each(["Paused", "ON HOLD", "Open", "To Do", "Backlog"])("uses Jira %s as To do ahead of stale orchestration", (status) => {
    const result = board([task("a", { jiraKey: "PTF-5271" })], {}, {
      jiraStatusOf: () => ({ status }),
      runsFor: () => [{ runId: "old", status: "done", startedAt: "", prUrl: "https://github.com/acme/app/pull/1" }],
      orchestrations: new Map([["a", { taskId: "a", taskDate: "2026-10-10", status: "ready-for-review", executionStep: "verify", openQuestions: 0, runCount: 1, updatedAt: "2026-10-16T10:00:00Z" }]]),
    });
    expect(result.cards[0].status).toBe("todo");
  });

  it("uses the task's own Jira key and done status category, never the parent's status", () => {
    const [card] = board([task("a", { jiraKey: "PTF-5271", links: [{ kind: "jira", id: "PTF-4891", label: "Parent" }] })], {}, {
      jiraStatusOf: (key) => key === "PTF-5271" ? { status: "Shipped", statusCategory: "done" } : { status: "Paused" },
      jiraParentOf: () => "PTF-4891",
    }).cards;
    expect(card).toMatchObject({ status: "done", parentJira: "PTF-4891" });
  });

  it("keeps live work and recorded statuses ahead of Jira defaults, including an explicit To do move", () => {
    const sources: Partial<BoardSources> = { jiraStatusOf: () => ({ status: "Code Review" }), runsFor: () => [{ runId: "live", status: "running", role: "implement", startedAt: "" }] };
    expect(board([task("a", { jiraKey: "PTF-5271" })], {}, sources).cards[0].status).toBe("in-progress");
    expect(board([task("a", { jiraKey: "PTF-5271" })], { a: note("a", { status: "blocked" }) }, sources).cards[0].status).toBe("blocked");
    const reset = note("a", { status: "in-progress" }, [{ op: "set_status", status: "todo" }]);
    expect(board([task("a", { jiraKey: "PTF-5271" })], { a: reset }, sources).cards[0]).toMatchObject({ status: "todo", statusSetAt: expect.any(String), attention: null });
  });

  it.each(["starting", "running"] as const)("keeps %s orchestration ahead of Jira defaults", (status) => {
    const sources: Partial<BoardSources> = {
      jiraStatusOf: () => ({ status: "Code Review" }),
      orchestrations: new Map([["a", { taskId: "a", taskDate: "2026-10-10", status, executionStep: "implement", openQuestions: 0, runCount: 1, updatedAt: "2026-10-17T10:00:00Z" }]]),
    };
    expect(board([task("a", { jiraKey: "PTF-5271" })], {}, sources).cards[0].status).toBe("in-progress");
  });

  it.each([undefined, { status: "In Progress" }])("falls back to run-derived status when Jira has no matching default (%j)", (jira) => {
    const sources: Partial<BoardSources> = { jiraStatusOf: () => jira, runsFor: () => [{ runId: "old", status: "done", startedAt: "", prUrl: "https://github.com/acme/app/pull/1" }] };
    expect(board([task("a", { jiraKey: "PTF-5271" })], {}, sources).cards[0].status).toBe("draft-pr");
  });

  it("lists a column per note status in order, with counts", () => {
    const result = board([task("a"), task("b")], { b: note("b", { status: "needs-you" }) });
    expect(result.columns.map((column) => column.status)).toEqual(["todo", "planning", "in-progress", "needs-you", "blocked", "draft-pr", "ready-for-review", "done"]);
    expect(result.columns.find((column) => column.status === "todo")?.count).toBe(1);
    expect(result.columns.find((column) => column.status === "needs-you")?.count).toBe(1);
  });

  it("takes the column from the note, and Done from a task that is done", () => {
    const done = { done: true, completedAt: "2026-10-16T09:00:00Z" };
    const result = board(
      [task("a"), task("b", done), task("c", done), task("d"), task("e")],
      { c: note("c", { status: "in-progress" }), d: note("d", { status: "blocked" }), e: note("e", { status: "todo" }) },
    );
    const status = Object.fromEntries(result.cards.map((card) => [card.taskId, card.status]));
    // c: ticking a task done in Tasks never touches its note, so a stale "in-progress" must not keep it on the board.
    expect(status).toEqual({ a: "todo", b: "done", c: "done", d: "blocked", e: "todo" });
  });

  it("logs the newest agent runs with their tier, model and reported cost", () => {
    const runs = [
      { runId: "r3", role: "review" as const, status: "done" as const, startedAt: "2026-10-17T10:00:00Z", provider: "claude", model: "opus", tier: { step: "review", tier: "heavy" } },
      { runId: "r2", role: "implement" as const, status: "failed" as const, startedAt: "2026-10-17T09:00:00Z", provider: "codex", tier: { step: "implement", tier: "mid" } },
      { runId: "r1", status: "done" as const, startedAt: "2026-10-16T09:00:00Z" },
    ];
    const usage: Record<string, { costUsd?: number; inputTokens?: number; outputTokens?: number }> = { r3: { costUsd: 0.42 }, r2: { inputTokens: 1000, outputTokens: 400 }, r1: { costUsd: 0 } };
    const [card] = board([task("a")], {}, { runsFor: () => runs, usageFor: (id) => usage[id] }).cards;
    expect(card.steps).toEqual([
      { runId: "r3", role: "review", status: "done", tier: "heavy", provider: "claude", model: "opus", costUsd: 0.42 },
      { runId: "r2", role: "implement", status: "failed", tier: "mid", provider: "codex", tokens: 1400 },
      { runId: "r1", role: "implement", status: "done" },
    ]);
  });

  it("says when an agent last edited the note, only for cards with a note", () => {
    const updates = { "task-notes/2026-10-10-a": { at: "2026-10-17T11:00:00Z", op: "set_status" }, "task-notes/2026-10-10-b": { at: "2026-10-17T11:00:00Z", op: "add_media" } };
    const cards = board([task("a"), task("b")], { a: note("a", { status: "in-progress" }) }, { agentNoteUpdates: updates }).cards;
    expect(cards.find((card) => card.taskId === "a")?.agentNoteUpdate).toEqual({ at: "2026-10-17T11:00:00Z", op: "set_status" });
    expect(cards.find((card) => card.taskId === "b")?.agentNoteUpdate).toBeUndefined();
  });

  it("keeps an unrecognised hand-written status visible in To do", () => {
    const [card] = board([task("a")], { a: note("a", { status: "parked" }) }).cards;
    expect(card).toMatchObject({ status: "todo", unknownStatus: "parked" });
  });

  describe("a note that records no progress takes its column from the orchestrator and the runs", () => {
    const orchestration = (patch: Partial<OrchestrationSummary>): Map<string, OrchestrationSummary> =>
      new Map([["a", { taskId: "a", taskDate: "2026-10-10", status: "running", executionStep: "plan", openQuestions: 0, runCount: 1, updatedAt: "2026-10-17T10:00:00Z", ...patch }]]);
    const run = (status: string, patch: Partial<ReturnType<BoardSources["runsFor"]>[number]> = {}) => ({ runId: "r1", status, startedAt: "2026-10-17T09:00:00Z", ...patch }) as ReturnType<BoardSources["runsFor"]>[number];
    const columnOf = (extra: Partial<BoardSources>, notes: Record<string, NoteRead> = {}) => board([task("a")], notes, extra).cards[0].status;

    it.each([
      [{ status: "starting" }, "planning"],
      [{ status: "running", executionStep: "plan" }, "planning"],
      [{ status: "running", executionStep: "implement" }, "in-progress"],
      [{ status: "running", executionStep: "verify" }, "in-progress"],
      [{ status: "running", executionStep: "draft-pr" }, "draft-pr"],
      [{ status: "needs-you" }, "needs-you"],
      [{ status: "pr-created", executionStep: "draft-pr" }, "draft-pr"],
      // A start that never dispatched is stuck; QA passing leaves the verify step waiting on John's review.
      [{ status: "paused", runCount: 0 }, "blocked"],
      [{ status: "paused", runCount: 2, executionStep: "verify" }, "in-progress"],
      [{ status: "stopped" }, "todo"],
      [{ status: "paused-manual" }, "todo"],
    ] as Array<[Partial<OrchestrationSummary>, string]>)("orchestration %o is %s", (patch, expected) => {
      expect(columnOf({ orchestrations: orchestration(patch) })).toBe(expected);
    });

    it("shows a wait for answers as Answer, not as a failed step with Retry", () => {
      const waiting = { kind: "questions", reason: "1 open question in the note after Plan. Answer it and auto mode carries on." };
      const orchestrations = orchestration({ status: "needs-you", executionStep: "plan", lastError: waiting.reason, auto: { phase: "plan", round: 0, maxRounds: 2, runs: [], waiting } as never });
      const [card] = board([task("a")], {}, { orchestrations }).cards;
      expect(card!.failure).toBeUndefined();
    });

    it("reads a live run when nothing is orchestrating: plan and discuss are Planning, anything else In progress", () => {
      expect(columnOf({ runsFor: () => [run("running", { role: "plan" })] })).toBe("planning");
      expect(columnOf({ runsFor: () => [run("queued", { role: "discuss" })] })).toBe("planning");
      expect(columnOf({ runsFor: () => [run("running", { role: "implement" })] })).toBe("in-progress");
      expect(columnOf({ runsFor: () => [run("running")] })).toBe("in-progress");
    });

    it("calls an open implementation PR a draft PR, but not a merged one, a review run's, or a finished run with none", () => {
      const pr = "https://github.com/o/app/pull/1";
      expect(columnOf({ runsFor: () => [run("done", { prUrl: pr, prState: "open" })] })).toBe("draft-pr");
      expect(columnOf({ runsFor: () => [run("done", { prUrl: pr })] })).toBe("draft-pr");
      expect(columnOf({ runsFor: () => [run("done", { prUrl: pr, prState: "merged" })] })).toBe("todo");
      expect(columnOf({ runsFor: () => [run("done", { prUrl: pr, prState: "closed" })] })).toBe("todo");
      expect(columnOf({ runsFor: () => [run("done", { role: "review", prUrl: pr, prState: "open" })] })).toBe("todo");
      expect(columnOf({ runsFor: () => [run("done"), run("failed")] })).toBe("todo");
    });

    it("follows auto mode's phase, and shows Ready for review when it finished", () => {
      const auto = (phase: "plan" | "implement" | "verify" | "fix", status: "running" | "ready-for-review" = "running") =>
        columnOf({ orchestrations: orchestration({ status, auto: { phase, round: phase === "fix" ? 1 : 0, maxRounds: 2, runs: [] } }) });
      expect(auto("plan")).toBe("planning");
      expect(auto("implement")).toBe("in-progress");
      expect(auto("verify")).toBe("draft-pr");
      expect(auto("fix")).toBe("draft-pr");
      expect(auto("verify", "ready-for-review")).toBe("ready-for-review");
    });

    it("labels auto-mode runs on the card's log and shows the auto line", () => {
      const map = orchestration({ auto: { phase: "fix", round: 1, maxRounds: 2, runs: [{ runId: "r1", phase: "fix", round: 1, tier: "heavy", tierReason: "fix round 1" }] } });
      const [card] = board([task("a")], {}, { orchestrations: map, runsFor: () => [run("running", { runId: "r1" })] }).cards;
      expect(card.steps[0]).toMatchObject({ label: "Fix 1", tierReason: "fix round 1" });
      expect(card.auto).toMatchObject({ phase: "fix", label: "Fix", round: 1, maxRounds: 2 });
    });

    it.each(["paused", "paused-manual"] as const)("carries %s into the card progress even without a waiting record", (status) => {
      const map = orchestration({ status, auto: { phase: "implement", round: 0, maxRounds: 2, runs: [] } });
      const [card] = board([task("a")], {}, { orchestrations: map }).cards;
      expect(card.auto).toMatchObject({ status, phase: "implement" });
    });

    it("lets the orchestrator outrank a bare run", () => {
      expect(columnOf({ orchestrations: orchestration({ status: "needs-you" }), runsFor: () => [run("running", { role: "implement" })] })).toBe("needs-you");
    });

    it("treats the scaffold's todo and a hand-written status as not recorded, but never overrides a real one", () => {
      const running = { orchestrations: orchestration({ executionStep: "implement" }) };
      expect(columnOf(running, { a: note("a", { status: "todo" }) })).toBe("in-progress");
      expect(columnOf(running, { a: note("a", { status: "parked" }) })).toBe("in-progress");
      expect(columnOf(running, { a: note("a", { status: "blocked" }) })).toBe("blocked");
      expect(columnOf(running, { a: note("a", { status: "ready-for-review" }) })).toBe("ready-for-review");
    });

    it("keeps the derived column on the card so the board knows a To do drop would not stick", () => {
      const running = { orchestrations: orchestration({ executionStep: "implement" }) };
      expect(board([task("a")], { a: note("a", { status: "blocked" }) }, running).cards[0]).toMatchObject({ status: "blocked", autoStatus: "in-progress" });
      expect(board([task("a")], {}).cards[0].autoStatus).toBeUndefined();
      expect(board([task("a", { done: true, completedAt: "2026-10-16T09:00:00Z" })], {}, running).cards[0].autoStatus).toBeUndefined();
    });

    it("still says the note's hand-written status is not a column", () => {
      const [card] = board([task("a")], { a: note("a", { status: "parked" }) }, { orchestrations: orchestration({}) }).cards;
      expect(card).toMatchObject({ status: "planning", unknownStatus: "parked" });
    });

    it("never moves a done task", () => {
      const [card] = board([task("a", { done: true, completedAt: "2026-10-16T09:00:00Z" })], {}, { orchestrations: orchestration({ status: "needs-you" }), runsFor: () => [run("running")] }).cards;
      expect(card).toMatchObject({ status: "done", attention: null });
    });
  });

  it("shows only the last 14 days of done work unless asked for all", () => {
    const old = task("old", { done: true, completedAt: new Date(NOW - 20 * DAY).toISOString() });
    const recent = task("recent", { done: true, completedAt: new Date(NOW - 2 * DAY).toISOString() });
    const windowed = board([old, recent], {});
    expect(windowed.cards.map((card) => card.taskId)).toEqual(["recent"]);
    expect(windowed.hiddenDone).toBe(1);
    expect(buildNotesBoard({ ...windowedSources([old, recent]), doneWindowDays: null }).cards).toHaveLength(2);
  });

  it("skips abandoned and moved tasks", () => {
    const result = board([task("gone", { abandonedAt: "2026-10-12T00:00:00Z" }), task("moved", { endDate: "2026-10-12", endReason: "legacy-moved" }), task("live")], {});
    expect(result.cards.map((card) => card.taskId)).toEqual(["live"]);
  });

  it("shows a task with no note as a task-only card previewing the pills its note would start with", () => {
    const [card] = board([task("a", { text: "Fix login #auth", jiraKey: "PTF-12" })], {}).cards;
    expect(card).toMatchObject({ notePath: null, noteHref: null, status: "todo", tags: ["auth"] });
    expect(card.links.some((link) => link.kind === "jira" && link.id === "PTF-12")).toBe(true);
  });

  it("reads summary lines, counts and links from the note", () => {
    const ops: TaskNoteOp[] = [
      { op: "set_summary", text: "First line.\n\nSecond line.\n\nThird line." },
      { op: "add_question", text: "Which env?" },
      { op: "add_decision", title: "Use cache", why: "faster" },
      { op: "add_bug", title: "Crash on save", severity: "blocker" },
      { op: "add_bug", title: "Typo", status: "fixed" },
    ];
    const meta = { status: "in-progress", tags: ["Notes"], models: ["sonnet"], links: [{ kind: "pr", id: "pr1", label: "app#1", href: "https://github.com/o/app/pull/1" }, { kind: "repo", id: "o/app", label: "app" }] };
    const [card] = board([task("a")], { a: note("a", meta, ops) }).cards;
    expect(card.summary).toEqual(["First line.", "Second line."]);
    expect(card.tags).toEqual(["notes"]);
    expect(card.models).toEqual(["sonnet"]);
    expect(card.repo).toBe("app");
    expect(card.prUrl).toBe("https://github.com/o/app/pull/1");
    expect(card.noteHref).toBe("/notes/task-notes/2026-10-10-a");
    expect(card.counts).toEqual({ openQuestions: 1, openBugs: 1, blockerBugs: 1, decisions: 1 });
  });

  it("prefers the Jev capture over a note screenshot, after over before", () => {
    const jev: JevInfo = { runId: "r", title: "t", status: "passed", capturedAt: "2026-10-17T10:00:00Z", bugCount: 1, goalsPassed: 2, goalsTotal: 3, receiptHref: "/qa?run=r&task=a", beforeVideo: "/b.webm", afterVideo: "/a.webm", screenshot: { url: "/api/qa/runs/r/media/after.png", phase: "after" } };
    const withJev = board([task("a")], { a: note("a", { status: "in-progress" }) }, { jev: new Map([["a", jev]]) }).cards[0];
    expect(withJev.screenshot).toEqual({ url: "/api/qa/runs/r/media/after.png", source: "jev" });
    expect(withJev.jev).toMatchObject({ bugCount: 1, beforeVideo: "/b.webm", afterVideo: "/a.webm", receiptHref: "/qa?run=r&task=a" });
    expect(board([task("a")], {}).cards[0].screenshot).toBeNull();
  });

  it("falls back to the last image pasted anywhere in the note when the Screenshots section is empty", () => {
    const blocks = [
      { type: "paragraph", content: [] },
      { type: "image", props: { url: "/api/notes-media/first.png" } },
      { type: "bulletListItem", children: [{ type: "image", props: { url: "/api/notes-media/last.png", caption: "Mini player" } }] },
      { type: "image", props: { url: "javascript:alert(1)" } },
    ];
    expect(lastImageBlock(blocks)).toEqual({ url: "/api/notes-media/last.png", caption: "Mini player" });
    expect(lastImageBlock([{ type: "paragraph" }])).toBeUndefined();
    const pasted: NoteRead = { ...note("a", { status: "in-progress" }), pastedImage: { url: "/api/notes-media/last.png" } };
    expect(board([task("a")], { a: pasted }).cards[0].screenshot).toEqual({ url: "/api/notes-media/last.png", source: "note" });
  });

  it("shows the tier per step from the task's orchestration, marking the active step", () => {
    const orchestration = { taskId: "a", taskDate: "2026-10-10", status: "running", executionStep: "implement", openQuestions: 0, runCount: 1, tiers: DEFAULT_MODEL_TIERS, updatedAt: "2026-10-17T10:00:00Z" } as const;
    const [card] = board([task("a")], {}, { orchestrations: new Map([["a", orchestration]]) }).cards;
    // Verify is the review (plus Jev), which runs on the Review tier, so that is the tier the card must name.
    expect(card.tiers?.map((entry) => [entry.step, entry.tier, entry.active])).toEqual([["plan", "mid", false], ["implement", "mid", true], ["verify", "heavy", false]]);
    expect(board([task("a")], {}).cards[0].tiers).toBeNull();
    const cheapReview = { ...orchestration, tiers: { ...DEFAULT_MODEL_TIERS, steps: { ...DEFAULT_MODEL_TIERS.steps, verify: "heavy", review: "cheap" } }, executionStep: "verify" } as const;
    const [verifying] = board([task("a")], {}, { orchestrations: new Map([["a", cheapReview as never]]) }).cards;
    expect(verifying.tiers?.find((entry) => entry.step === "verify")).toMatchObject({ tier: "cheap", active: true });
  });

  it("flags stuck cards and sorts them first", () => {
    const result = board([task("calm"), task("failing")], {}, { runsFor: (id) => (id === "failing" ? [{ runId: "r1", status: "failed", startedAt: "2026-10-17T09:00:00Z" }] : []) });
    expect(result.cards[0]).toMatchObject({ taskId: "failing", attention: { reason: "failing", action: { kind: "retry" } } });
    expect(result.cards[1].attention).toBeNull();
  });

  it("takes the repo from the task when the note has no task-meta block, so the repo filter finds it", () => {
    // Hand-written notes (the Vowbreak M0 note) start with a heading, not a task-meta fence: their view's meta is {}.
    const blocks = textToBlocks("## Captured\n\nRepo: vowbreak.\n") as unknown[];
    const bare: NoteRead = { notePath: "task-notes/2026-10-10-a", view: readTaskNote(blocks), modified: NOW - 1000 };
    const links = [{ kind: "repo" as const, id: "vowbreak", label: "vowbreak" }];
    const [card] = board([task("a", { links })], { a: bare }).cards;
    expect(card.repo).toBe("vowbreak");
    expect(card.links).toContainEqual(expect.objectContaining({ kind: "repo", id: "vowbreak" }));
  });

  it("keeps the note's own repo over the task's", () => {
    const meta = { status: "in-progress", links: [{ kind: "repo", id: "o/app", label: "app" }] };
    const [card] = board([task("a", { links: [{ kind: "repo", id: "o/other", label: "other" }] })], { a: note("a", meta) }).cards;
    expect(card.repo).toBe("app");
    expect(card.links.filter((link) => link.kind === "repo")).toHaveLength(1);
  });

  it("lists every image for the viewer, newest first, thumbnail first, without duplicates", () => {
    const blocks = [
      { type: "image", props: { url: "/api/notes-media/one.png" } },
      { type: "paragraph", children: [{ type: "image", props: { url: "/api/notes-media/two.png", caption: " Two " } }] },
      { type: "image", props: { url: "javascript:alert(1)" } },
    ];
    expect(imageBlocks(blocks)).toEqual([{ url: "/api/notes-media/one.png" }, { url: "/api/notes-media/two.png", caption: "Two" }]);
    const view = readTaskNote(textToBlocks("# T\n") as unknown[]);
    view.media = [
      { id: "1", kind: "image", url: "/api/notes-media/shot-1.png", caption: "", name: "shot-1.png" },
      { id: "2", kind: "video", url: "/api/notes-media/rec.webm", caption: "", name: "rec.webm" },
      { id: "3", kind: "image", url: "/api/notes-media/shot-2.png", caption: "Second", name: "shot-2.png" },
    ];
    const images = cardImages({ url: "/api/qa/runs/r/media/after.png", source: "jev" }, view, [{ url: "/api/notes-media/shot-2.png" }, { url: "/api/notes-media/two.png" }]);
    expect(images.map((image) => image.url)).toEqual(["/api/qa/runs/r/media/after.png", "/api/notes-media/shot-2.png", "/api/notes-media/shot-1.png", "/api/notes-media/two.png"]);
    expect(images[1]).toEqual({ url: "/api/notes-media/shot-2.png", caption: "Second", name: "shot-2.png", source: "note" });
    expect(cardImages(null, null, undefined)).toEqual([]);
  });

  it("lists the card's Jira keys, task's first, with the parent DevHub knows and none when it doesn't", () => {
    const parents: Record<string, string> = { "PTF-5001": "PTF-4891", "PTF-4891": "PTF-1" };
    const cards = board(
      [task("a", { jiraKey: "ptf-5001" }), task("b", { jiraKey: "PTF-4891" }), task("c", { jiraKey: "DAD-7" }), task("d")],
      { a: note("a", { status: "todo", links: [{ kind: "jira", id: "PTF-5001", label: "PTF-5001" }, { kind: "jira", id: "DAD-9", label: "DAD-9" }] }) },
      { jiraParentOf: (key) => parents[key] },
    ).cards;
    const byId = Object.fromEntries(cards.map((card) => [card.taskId, card]));
    expect(byId.a).toMatchObject({ jira: ["PTF-5001", "DAD-9"], parentJira: "PTF-4891" });
    expect(byId.b).toMatchObject({ jira: ["PTF-4891"], parentJira: "PTF-1" });
    expect(byId.c.jira).toEqual(["DAD-7"]);
    expect(byId.c.parentJira).toBeUndefined();
    expect(byId.d.jira).toBeUndefined();
  });

  it("reports unreadable notes instead of hiding them", () => {
    const result = board([task("a")], { a: { notePath: "task-notes/2026-10-10-a", view: null, modified: null, error: "not a BlockNote note" } });
    expect(result.errors).toEqual(["task-notes/2026-10-10-a: not a BlockNote note"]);
  });

  it("drops old done work before reading its note, so a broken old note is not reported", () => {
    const old = task("old", { done: true, completedAt: new Date(NOW - 30 * DAY).toISOString() });
    const reads: string[] = [];
    const result = board([old, task("live")], {}, {
      noteFor: (t) => {
        reads.push(t.id);
        return { notePath: `task-notes/2026-10-10-${t.id}`, view: null, modified: null, ...(t.id === "old" ? { error: "boom" } : {}) };
      },
    });
    expect(reads).toEqual(["live"]);
    expect(result).toMatchObject({ hiddenDone: 1, errors: [] });
    expect(result.cards.map((card) => card.taskId)).toEqual(["live"]);
  });

  it("falls back to the note's last edit for a done task with no completion time", () => {
    const stale = task("stale", { done: true });
    const staleNote = { ...note("stale", { status: "done" }), modified: NOW - 40 * DAY };
    const fresh = task("fresh", { done: true });
    const freshNote = { ...note("fresh", { status: "done" }), modified: NOW - 1 * DAY };
    const result = board([stale, fresh], { stale: staleNote, fresh: freshNote });
    expect(result.cards.map((card) => card.taskId)).toEqual(["fresh"]);
    expect(result.hiddenDone).toBe(1);
  });

  it("encodes the note path in the link, and links a card to its own note", () => {
    const [card] = board([task("a")], { a: { ...note("a", { status: "todo" }), notePath: "task-notes/2026-10-10-a b" } }).cards;
    expect(card.noteHref).toBe("/notes/task-notes/2026-10-10-a%20b");
    expect(card.notePath).toBe("task-notes/2026-10-10-a b");
  });

  describe("attention from the orchestrator and the PR", () => {
    const waiting = new Map<string, OrchestrationSummary>([["a", { taskId: "a", taskDate: "2026-10-10", status: "needs-you", executionStep: "plan", openQuestions: 1, runCount: 0, updatedAt: "2026-10-17T10:00:00Z" }]]);

    it("sends John to the Storyboard card for the orchestrator's question, even with no note", () => {
      const [card] = board([task("a")], {}, { orchestrations: waiting }).cards;
      expect(card).toMatchObject({ status: "needs-you", noteHref: null, attention: { reason: "awaiting", action: { kind: "open", label: "Answer", href: "/storyboard?task=a" } } });
    });

    it("marks the card waiting on a repo only while the orchestrator's repo question is open", () => {
      const repoWait = new Map<string, OrchestrationSummary>([["a", { ...waiting.get("a")!, waitingOnRepo: true }]]);
      expect(board([task("a")], {}, { orchestrations: repoWait }).cards[0].waitingOnRepo).toBe(true);
      expect(board([task("a")], {}, { orchestrations: waiting }).cards[0].waitingOnRepo).toBeUndefined();
      const planReady = new Map<string, OrchestrationSummary>([["a", { ...waiting.get("a")!, openQuestions: 0, runCount: 1, auto: { phase: "plan", round: 0, maxRounds: 2, runs: [], waiting: { kind: "plan-approval", reason: "Plan ready" } } }]]);
      expect(board([task("a")], {}, { orchestrations: planReady }).cards[0].waitingOnRepo).toBeUndefined();
    });

    it("prefers the note's own questions when it has open ones", () => {
      const withQuestion = note("a", { status: "in-progress" }, [{ op: "add_question", text: "Which env?" }]);
      const [card] = board([task("a")], { a: withQuestion }, { orchestrations: waiting }).cards;
      expect(card.attention?.action).toMatchObject({ kind: "open", href: "/notes/task-notes/2026-10-10-a#task-note-questions" });
    });

    it("still asks even when the note's status says the task is moving", () => {
      const [card] = board([task("a")], { a: note("a", { status: "in-progress" }) }, { orchestrations: waiting }).cards;
      expect(card).toMatchObject({ status: "in-progress", attention: { label: "Waiting on you" } });
    });

    it("carries the PR watcher's state, and stops asking for review once the PR is merged", () => {
      const pr = "https://github.com/o/app/pull/9";
      const review = { a: note("a", { status: "ready-for-review" }) };
      const open = board([task("a")], review, { runsFor: () => [{ runId: "r1", status: "done", startedAt: "2026-10-17T09:00:00Z", prUrl: pr, prState: "open" }] }).cards[0];
      expect(open).toMatchObject({ prUrl: pr, prState: "open", attention: { label: "PR awaiting review", action: { kind: "open-pr", url: pr } } });
      const merged = board([task("a")], review, { runsFor: () => [{ runId: "r1", status: "done", startedAt: "2026-10-17T09:00:00Z", prUrl: pr, prState: "merged" }] }).cards[0];
      expect(merged).toMatchObject({ prUrl: pr, prState: "merged", attention: null });
    });

    it("has no PR state for a PR that is only a link on the note", () => {
      const linked = note("a", { status: "ready-for-review", links: [{ kind: "pr", id: "p", label: "app#1", href: "https://github.com/o/app/pull/1" }] });
      const [card] = board([task("a")], { a: linked }).cards;
      expect(card.prState).toBeUndefined();
      expect(card.attention).toMatchObject({ label: "PR awaiting review" });
    });

    it("does not offer Retry for a failed review or plan run, which Retry cannot redo", () => {
      const failed = (role: string) => ({ runId: "r1", status: "failed", role, startedAt: "2026-10-17T09:00:00Z" }) as ReturnType<BoardSources["runsFor"]>[number];
      expect(board([task("a")], {}, { runsFor: () => [failed("review")] }).cards[0]).toMatchObject({ attention: null, run: { status: "failed", role: "review" } });
      expect(board([task("a")], {}, { runsFor: () => [failed("plan")] }).cards[0].attention).toBeNull();
      expect(board([task("a")], {}, { runsFor: () => [failed("implement")] }).cards[0].attention).toMatchObject({ action: { kind: "retry" } });
    });
  });
});

function windowedSources(tasks: Task[]): BoardSources {
  return { tasks, now: NOW, doneWindowDays: 14, noteFor: (t) => ({ notePath: `task-notes/x-${t.id}`, view: null, modified: null }), runsFor: () => [], orchestrations: new Map(), jev: new Map(), errors: [] };
}


describe("work insights", () => {
  it("totals every run, keeps the four-step contract, and includes hidden completed work in period totals", () => {
    const runs = Array.from({ length: 6 }, (_, i) => ({ runId: `r${i}`, status: "done" as const, startedAt: "2026-10-17T10:00:00Z" }));
    const result = board([task("a"), task("hidden", { done: true, completedAt: "2026-09-01T10:00:00Z" })], {}, {
      runsFor: (id) => id === "a" ? runs : [{ runId: "hidden-run", status: "done", startedAt: "2026-10-17T09:00:00Z" }],
      usageFor: () => ({ costUsd: 0.25 }),
    });
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].steps).toHaveLength(4);
    expect(result.cards[0].usage).toHaveLength(6);
    expect(result.cards[0].costUsd).toBe(1.5);
    expect(result.cost).toEqual({ todayUsd: 1.75, weekUsd: 1.75 });
  });

  it("does not invent prices from tokens, zero, invalid or absent cost", () => {
    for (const costUsd of [undefined, 0, -1, NaN, Infinity]) {
      const result = board([task("a")], {}, { runsFor: () => [{ runId: "r", status: "done", startedAt: "2026-10-17T10:00:00Z" }], usageFor: () => ({ costUsd, inputTokens: 1000 }) });
      expect(result.cards[0].costUsd).toBeUndefined();
      expect(result.cost).toBeUndefined();
    }
  });

  it("derives a failure, clears only its matching key and preserves history", () => {
    const runs: BoardSources["runsFor"] = () => [{ runId: "failed", status: "failed", role: "plan", startedAt: "2026-10-17T10:00:00Z", updatedAt: "2026-10-17T11:00:00Z" }];
    const source = { runsFor: runs, usageFor: () => ({ error: "ECONNREFUSED", exitCode: 1 }) };
    const failed = board([task("a")], { a: note("a", { status: "needs-you" }) }, source).cards[0];
    expect(failed.failure?.summary).toContain("Couldn’t connect");
    const cleared = board([task("a")], { a: note("a", { status: "needs-you" }) }, { ...source, clearedFailureFor: () => failed.failure!.key }).cards[0];
    expect(cleared.failure?.cleared).toBe(true);
    expect(cleared.status).toBe("planning");
    expect(cleared.steps[0].status).toBe("failed");
    expect(board([task("a")], {}, { ...source, usageFor: () => ({ error: "different error" }), clearedFailureFor: () => failed.failure!.key }).cards[0].failure?.cleared).toBeUndefined();
  });

  it("keeps a card someone moved back to To do after its failure was cleared", () => {
    const runs: BoardSources["runsFor"] = () => [{ runId: "failed", status: "failed", role: "implement", startedAt: "2026-10-17T10:00:00Z", updatedAt: "2026-10-17T11:00:00Z" }];
    const source = { runsFor: runs, usageFor: () => ({ error: "ECONNREFUSED", exitCode: 1 }) };
    const key = board([task("a")], { a: note("a", { status: "needs-you" }) }, source).cards[0].failure!.key;
    const moved = board([task("a")], { a: note("a", { status: "todo", statusSetAt: "2026-10-17T12:00:00Z" }) }, { ...source, clearedFailureFor: () => key }).cards[0];
    expect(moved.failure?.cleared).toBe(true);
    expect(moved.status).toBe("todo");
  });

  it("requires a completed review request with actual notes", () => {
    for (const status of ["running", "failed", "done"] as const) {
      const result = board([task("a")], {}, { runsFor: () => [{ runId: "review", role: "review", status, startedAt: "" }], usageFor: () => ({ reviewText: "## Findings\nFix the retry race." }) });
      expect(Boolean(result.cards[0].review)).toBe(status === "done");
    }
    expect(board([task("a")], {}, { runsFor: () => [{ runId: "review", role: "review", status: "done", startedAt: "" }] }).cards[0].review).toBeUndefined();
  });
});

it("projects structured context and the latest attachment without replacing old screenshot fields", () => {
  const statusUpdate = { summary: "Plan ready", whatChanged: "Wrote the plan", currentState: "Waiting", nextStep: "Approve" };
  const result = board([task("a")], { a: note("a", {}, [
    { op: "set_status_update", statusUpdate },
    { op: "add_media", assetPath: "task-notes/assets/one.png" },
    { op: "add_media", assetPath: "task-notes/assets/two.png" },
  ]) });
  expect(result.cards[0]).toMatchObject({ statusUpdate, summary: ["Plan ready"], latestScreenshot: { url: expect.stringContaining("two.png"), source: "note" } });
  expect(result.cards[0].images).toHaveLength(2);
});


it("shows a paused plan as approval even when an older record has a waiting reason in lastError", () => {
  const [card] = board([task("a")], { a: note("a", { status: "needs-you" }) }, {
    runsFor: () => [{ runId: "plan", role: "plan", status: "done", startedAt: "" }],
    orchestrations: new Map([["a", {
      taskId: "a", taskDate: "2026-10-10", status: "needs-you", executionStep: "plan", openQuestions: 0, runCount: 1, updatedAt: "2026-10-17T10:00:00Z",
      lastError: "Plan ready. Approve it to continue on Auto, or request a revision.",
      auto: { phase: "plan", round: 0, maxRounds: 2, runs: [], pauseAfterPlan: true, planRunId: "plan", waiting: { kind: "plan-approval", reason: "Plan ready" } },
    }]]),
  }).cards;
  expect(card.failure).toBeUndefined();
  expect(resolveWorkPresentation(card, undefined, NOW)).toMatchObject({ status: "Plan ready", action: { kind: "approve-plan" } });
});

it("keeps a newer failure ahead of an older review whose sidecar was reconciled later", () => {
  const result = board([task("a")], {}, {
    runsFor: () => [
      { runId: "review", role: "review", status: "done", startedAt: "2026-10-17T09:00:00Z", updatedAt: "2026-10-17T11:30:00Z" },
      { runId: "failed", role: "implement", status: "failed", startedAt: "2026-10-17T10:00:00Z", updatedAt: "2026-10-17T11:00:00Z" },
    ],
    usageFor: (id) => id === "review" ? { stateChangedAt: NOW - 2 * 3600000, reviewText: "Old review notes" } : { stateChangedAt: NOW - 3600000, error: "Timeout", exitCode: 1 },
  });
  expect(result.cards[0].run?.runId).toBe("failed");
  expect(resolveWorkPresentation(result.cards[0], undefined, NOW).action?.label).toBe("Retry");
});

it("keeps a successful run ahead of an older failure whose sidecar was reconciled later", () => {
  const [card] = board([task("a")], { a: note("a", { status: "done" }) }, {
    runsFor: () => [
      { runId: "failed", role: "implement", status: "failed", startedAt: "2026-10-17T09:00:00Z", updatedAt: "2026-10-17T11:30:00Z" },
      { runId: "success", role: "implement", status: "done", startedAt: "2026-10-17T10:00:00Z", updatedAt: "2026-10-17T11:00:00Z", prUrl: "https://github.com/acme/app/pull/1", prState: "open" },
    ],
    usageFor: (id) => id === "failed" ? { stateChangedAt: NOW - 2 * 3600000, error: "Timeout", exitCode: 1 } : { stateChangedAt: NOW - 3600000, exitCode: 0 },
  }).cards;
  expect(card.run?.runId).toBe("success");
  expect(card.failure).toBeUndefined();
  expect(card.steps.find((step) => step.runId === "failed")?.status).toBe("failed");
  expect(resolveWorkPresentation(card, undefined, NOW)).toMatchObject({ needsYou: true, action: { kind: "finish" } });
});

it("keeps failure acknowledgement stable across sidecar metadata refreshes but rejects a new failure event", () => {
  let updatedAt = "2026-10-17T11:00:00Z";
  let stateChangedAt = NOW - 3600000;
  const source: Partial<BoardSources> = {
    runsFor: () => [{ runId: "failed", status: "failed", role: "implement", startedAt: "2026-10-17T10:00:00Z", updatedAt }],
    usageFor: () => ({ stateChangedAt, error: "Timeout", exitCode: 1 }),
  };
  const key = board([task("a")], {}, source).cards[0].failure!.key;
  updatedAt = "2026-10-17T11:30:00Z";
  expect(board([task("a")], {}, { ...source, clearedFailureFor: () => key }).cards[0].failure?.cleared).toBe(true);
  stateChangedAt += 1000;
  expect(board([task("a")], {}, { ...source, clearedFailureFor: () => key }).cards[0].failure?.cleared).toBeUndefined();
});

it("retains legacy failure acknowledgements after switching to lifecycle timestamps", () => {
  const run = { runId: "failed", status: "failed" as const, role: "implement" as const, startedAt: "2026-10-17T10:00:00Z", updatedAt: "2026-10-17T11:05:00Z" };
  const source = { runsFor: () => [run], usageFor: () => ({ error: "Timeout", exitCode: 1 }) };
  const legacyKey = board([task("a")], {}, source).cards[0].failure!.key;
  const migrated = { ...source, usageFor: () => ({ ...source.usageFor(), stateChangedAt: NOW - 3600000 }), clearedFailureFor: () => legacyKey };
  expect(board([task("a")], {}, migrated).cards[0].failure?.cleared).toBe(true);
  expect(board([task("a")], {}, { ...migrated, usageFor: () => ({ ...source.usageFor(), stateChangedAt: NOW }) }).cards[0].failure?.cleared).toBeUndefined();
});
