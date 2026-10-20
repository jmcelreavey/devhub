import { describe, expect, it } from "vitest";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { repoTaskWork } from "./repo-task-work";

const now = Date.parse("2026-10-20T12:00:00Z");
function card(id: string, patch: Partial<BoardCard> = {}): BoardCard {
  return { taskId: id, title: id, task: { id, text: id, done: false, createdAt: "", startDate: "2026-10-20", rank: "a", links: [{ kind: "repo", id: "acme/app", label: "app" }] },
    date: "2026-10-20", status: "todo", taskDone: false, notePath: `task-notes/${id}`, noteHref: `/notes/task-notes/${id}`,
    tags: [], links: [], models: [], summary: [], counts: { openQuestions: 0, openBugs: 0, blockerBugs: 0, decisions: 0 },
    images: [], screenshot: null, jev: null, tiers: null, run: null, steps: [], attention: null, updatedAt: "2026-10-20T11:59:00Z", ...patch };
}
const project = (cards: BoardCard[]) => repoTaskWork(cards, [], "app", "acme/app", now);

describe("repo task work", () => {
  it("puts decisions and failures before live work, with one shared next action", () => {
    const result = project([
      card("todo"),
      card("running", { status: "in-progress", auto: { status: "running", phase: "implement", label: "Implementing", round: 0, maxRounds: 3 } }),
      card("question", { status: "blocked", counts: { openQuestions: 1, openBugs: 0, blockerBugs: 0, decisions: 0 } }),
      card("review", { status: "ready-for-review", prUrl: "https://github.com/acme/app/pull/1" }),
      card("failed", { status: "blocked", failure: { key: "failure", summary: "Check failed" } }),
    ]);
    expect(result.backlog.map(({ card }) => card.taskId)).toEqual(["todo"]);
    expect(result.backlog[0].presentation.action?.kind).toBe("start-auto");
    expect(result.active.map(({ card }) => card.taskId)).toEqual(["question", "failed", "review", "running"]);
    expect(result.active.map(({ presentation }) => presentation.action?.kind)).toEqual(["answer", "retry", "review", "progress"]);
    expect(result.active.find(({ card }) => card.taskId === "review")?.presentation.status).toContain("Ready for review");
    expect(result.active.some(({ presentation }) => presentation.status.includes("Review requested"))).toBe(false);
  });

  it("keeps live or paused auto work out of the backlog even when its note says To do", () => {
    const result = project([
      card("live", { auto: { status: "running", phase: "implement", label: "Implementing", round: 0, maxRounds: 3 } }),
      card("paused", { auto: { status: "paused-manual", phase: "implement", label: "Paused", round: 0, maxRounds: 3 } }),
    ]);
    expect(result.backlog).toEqual([]);
    expect(result.active).toHaveLength(2);
    expect(result.active.some(({ presentation }) => presentation.action?.kind === "start-auto")).toBe(false);
  });

  it("matches explicit task or board repo links, excludes other repos and deduplicates tasks", () => {
    const linked = card("linked");
    expect(project([linked, linked, card("note", { task: undefined, repo: "app" }), card("other", { task: undefined, repo: "web" }), card("unlinked", { task: undefined })]).backlog.map(({ card }) => card.taskId)).toEqual(["linked", "note"]);
  });

  it("archives finished tasks but keeps work awaiting task completion visible", () => {
    const result = project([card("finished", { taskDone: true, status: "done" }), card("finish-me", { status: "done" })]);
    expect(result.done.map(({ card }) => card.taskId)).toEqual(["finished"]);
    expect(result.active[0].presentation.action?.kind).toBe("finish");
  });
});
