import { afterEach, expect, it, vi } from "vitest";
import { subscribeCoreEvents } from "../../domains/events/core-events";
import { invalidateGithubPrsCache, writeGithubPrsListCache } from "../github/prs";
import { invalidateJiraTicketsCache, setJiraTicketsCache } from "../jira/tickets-cache";
import { buildNotesBoard, type BoardSources } from "./notes-board";
import { IDLE_AFTER_MS } from "../../../../../packages/shared/ui-lib/storyboard/attention";

afterEach(() => {
  invalidateGithubPrsCache();
  invalidateJiraTicketsCache();
  vi.useRealTimers();
});

it("invalidates the board when remote caches change or expire", () => {
  vi.useFakeTimers();
  const events = vi.fn();
  const unsubscribe = subscribeCoreEvents(events);
  try {
    setJiraTicketsCache([{ key: "TEST-1" }]);
    invalidateJiraTicketsCache();
    writeGithubPrsListCache({ configured: true, authored: [], reviews: [], recentlyReviewed: [] });
    expect(events).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(120_000);
    expect(events).toHaveBeenCalledTimes(4);
    expect(events).toHaveBeenLastCalledWith("board");
  } finally {
    unsubscribe();
  }
});

it("schedules the next idle transition instead of polling", () => {
  const now = new Date(2026, 9, 29, 12).getTime();
  const startedAt = now - IDLE_AFTER_MS + 20_000;
  const task = { id: "task-1", text: "Running task", done: false, startDate: "2026-10-29", rank: "a", createdAt: new Date(now).toISOString() };
  const sources: BoardSources = {
    tasks: [task], now, doneWindowDays: 14,
    noteFor: () => ({ notePath: "task-notes/task-1", view: null, modified: null }),
    runsFor: () => [{ runId: "run-1", status: "running", startedAt: new Date(startedAt).toISOString() }],
    orchestrations: new Map(), jev: new Map(), errors: [],
  };
  const board = buildNotesBoard(sources);
  expect(board.nextChangeAt).toBe(now + 20_001);
  expect(board.cards[0].attention).toBeNull();
  const idle = buildNotesBoard({ ...sources, now: board.nextChangeAt! });
  expect(idle.cards[0].attention?.reason).toBe("idle");
});

it("schedules finished work expiry and the next local midnight", () => {
  const now = new Date(2026, 9, 29, 12).getTime();
  const completedAt = now - 14 * 24 * 60 * 60 * 1000 + 30_000;
  const task = { id: "task-1", text: "Done task", done: true, startDate: "2026-10-01", rank: "a", createdAt: new Date(completedAt).toISOString(), completedAt: new Date(completedAt).toISOString() };
  const sources: BoardSources = {
    tasks: [task], now, doneWindowDays: 14,
    noteFor: () => ({ notePath: "task-notes/task-1", view: null, modified: null }),
    runsFor: () => [], orchestrations: new Map(), jev: new Map(), errors: [],
  };
  const board = buildNotesBoard(sources);
  expect(board.nextChangeAt).toBe(now + 30_001);
  expect(buildNotesBoard({ ...sources, now: board.nextChangeAt! }).cards).toHaveLength(0);
  const all = buildNotesBoard({ ...sources, doneWindowDays: null });
  const midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
  expect(all.nextChangeAt).toBe(midnight.getTime());
});
