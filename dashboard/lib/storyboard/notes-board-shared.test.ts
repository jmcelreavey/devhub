import { describe, expect, it } from "vitest";
import { rankBetween } from "@shared/task-note/rank.ts";
import { boardFilterOptions, cardMatchesFilters, compareCards, filtersFromParams, moveCheck, NO_JIRA, rankPlan, type BoardFilters } from "./notes-board-shared";

describe("moveCheck", () => {
  it("lets a manual move override a column derived from auto mode or runs", () => {
    expect(moveCheck({ status: "in-progress", taskDone: false, autoStatus: "in-progress" }, "blocked")).toEqual({ ok: true });
    expect(moveCheck({ status: "planning", taskDone: false, autoStatus: "planning" }, "done")).toEqual({ ok: true });
    expect(moveCheck({ status: "blocked", taskDone: false }, "todo")).toEqual({ ok: true });
    expect(moveCheck({ status: "in-progress", taskDone: false, autoStatus: "in-progress" }, "todo")).toEqual({ ok: true });
    expect(moveCheck({ status: "blocked", taskDone: false, autoStatus: "planning" }, "todo")).toEqual({ ok: true });
  });

  it("allows moving a finished task back in one action", () => {
    expect(moveCheck({ status: "done", taskDone: true }, "in-progress")).toEqual({ ok: true });
  });

  it("treats dropping where it already is as a no-op", () => {
    expect(moveCheck({ status: "todo", taskDone: false }, "todo")).toMatchObject({ ok: false, reason: "Already in To do." });
  });
});

describe("board filters", () => {
  const cards = [
    { taskId: "a", repo: "vowbreak", tags: ["game"], jira: undefined },
    { taskId: "b", repo: "app", tags: [], jira: ["PTF-5001"], parentJira: "PTF-4891" },
    { taskId: "c", repo: "app", tags: [], jira: ["PTF-4891"] },
    { taskId: "d", tags: [], jira: ["DAD-7", "PTF-4891"] },
  ];
  const ids = (filters: BoardFilters) => cards.filter((card) => cardMatchesFilters(card, filters)).map((card) => card.taskId);

  it("matches repo case-insensitively, tag without #, a Jira key or No Jira", () => {
    expect(ids({ repo: "VowBreak" })).toEqual(["a"]);
    expect(ids({ tag: "#Game" })).toEqual(["a"]);
    expect(ids({ jira: "ptf-4891" })).toEqual(["c", "d"]);
    expect(ids({ jira: NO_JIRA })).toEqual(["a"]);
  });

  it("matches a parent's children and cards linked to the parent itself, and combines filters", () => {
    expect(ids({ parentJira: "PTF-4891" })).toEqual(["b", "c", "d"]);
    expect(ids({ parentJira: "PTF-4891", repo: "app" })).toEqual(["b", "c"]);
    expect(ids({ parentJira: "PTF-9999" })).toEqual([]);
  });

  it("offers only values on the board and reads filters from the URL", () => {
    expect(boardFilterOptions(cards)).toEqual({ repos: ["app", "vowbreak"], tags: ["game"], jira: ["DAD-7", "PTF-4891", "PTF-5001"], parents: ["PTF-4891"], noJira: true });
    expect(filtersFromParams(new URLSearchParams("repo=vowbreak&jira=&parentJira=PTF-4891&done=all"))).toEqual({ repo: "vowbreak", parentJira: "PTF-4891" });
  });
});

describe("card order", () => {
  const at = (updatedAt: string, patch: object = {}) => ({ rank: undefined as string | undefined, attention: null, updatedAt, ...patch });

  it("puts ranked cards first by rank, then stuck cards, then the newest", () => {
    const cards = { a: at("2026-10-17", { rank: "m" }), b: at("2026-10-15", { rank: "c" }), c: at("2026-10-16", { attention: { reason: "failed" } }), d: at("2026-10-17") };
    const order = Object.entries(cards).sort(([, x], [, y]) => compareCards(x as never, y as never)).map(([id]) => id);
    expect(order).toEqual(["b", "a", "c", "d"]);
  });

  it("plans one rank write for a move among ranked cards, and none for no move", () => {
    const column = [{ taskId: "a", rank: "c" }, { taskId: "b", rank: "m" }, { taskId: "c", rank: "t" }];
    const [write, ...rest] = rankPlan(column, { taskId: "c" }, 1, rankBetween);
    expect(rest).toEqual([]);
    expect(write!.taskId).toBe("c");
    expect(write!.rank > "c" && write!.rank < "m").toBe(true);
    expect(rankPlan(column, { taskId: "b" }, 1, rankBetween)).toEqual([]);
    expect(rankPlan(column, { taskId: "a" }, 2, rankBetween)[0]!.rank > "t").toBe(true);
  });

  it("ranks never-ranked cards above the spot once, so a move below them sticks", () => {
    const column = [{ taskId: "a", rank: "c" }, { taskId: "b" }, { taskId: "c" }, { taskId: "d" }];
    const plan = rankPlan(column, { taskId: "d" }, 2, rankBetween);
    expect(plan.map((entry) => entry.taskId)).toEqual(["b", "d"]);
    const ranks = ["c", ...plan.map((entry) => entry.rank)];
    expect([...ranks].sort()).toEqual(ranks);
    // Top of a column of unranked cards: one write.
    expect(rankPlan([{ taskId: "x" }, { taskId: "y" }], { taskId: "y" }, 0, rankBetween)).toEqual([{ taskId: "y", rank: "i" }]);
  });
});
