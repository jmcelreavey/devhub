import { describe, it, expect } from "vitest";
import { buildWeeklyReview, weekWindow } from "./tasks-weekly";
import type { Task, TaskDay } from "./tasks-storage";

function task(partial: Partial<Task> & { text: string }): Task {
  return {
    id: Math.random().toString(36).slice(2),
    done: false,
    createdAt: "2026-05-25T09:00:00.000Z",
    ...partial,
  };
}

function day(date: string, tasks: Task[]): TaskDay {
  return {
    date,
    total: tasks.length,
    completed: tasks.filter((t) => t.done).length,
    abandoned: tasks.filter((t) => !!t.abandonedAt).length,
    moved: tasks.filter((t) => !!t.movedAt).length,
    modified: 0,
    tasks,
  };
}

describe("weekWindow", () => {
  it("returns 7 ascending dates ending at end", () => {
    expect(weekWindow("2026-05-30")).toEqual([
      "2026-05-24",
      "2026-05-25",
      "2026-05-26",
      "2026-05-27",
      "2026-05-28",
      "2026-05-29",
      "2026-05-30",
    ]);
  });

  it("crosses month boundaries", () => {
    expect(weekWindow("2026-06-02")[0]).toBe("2026-05-27");
  });
});

describe("buildWeeklyReview", () => {
  it("aggregates totals only within the 7-day window", () => {
    const review = buildWeeklyReview(
      [
        day("2026-05-20", [task({ text: "old", done: true })]), // outside window
        day("2026-05-28", [task({ text: "a", done: true }), task({ text: "b" })]),
        day("2026-05-30", [task({ text: "c", done: true }), task({ text: "d", abandonedAt: "x" })]),
      ],
      "2026-05-30",
    );
    expect(review.start).toBe("2026-05-24");
    expect(review.end).toBe("2026-05-30");
    expect(review.totals).toEqual({ created: 4, completed: 2, abandoned: 1, moved: 0 });
    expect(review.days).toHaveLength(7);
  });

  it("fills missing days with zeroes", () => {
    const review = buildWeeklyReview([day("2026-05-30", [task({ text: "c" })])], "2026-05-30");
    const empty = review.days.find((d) => d.date === "2026-05-27");
    expect(empty).toEqual({ date: "2026-05-27", created: 0, completed: 0, abandoned: 0, moved: 0 });
  });

  it("flags tasks that moved on 3+ distinct days as slipped", () => {
    const review = buildWeeklyReview(
      [
        day("2026-05-26", [task({ text: "Chase DAD-1 review", jiraKey: "DAD-1", movedAt: "x" })]),
        day("2026-05-27", [task({ text: "chase dad-1 review", movedAt: "x" })]),
        day("2026-05-28", [task({ text: "Chase DAD-1 review", movedAt: "x" })]),
        day("2026-05-29", [task({ text: "Chase DAD-1 review" })]), // landed, not moved
        day("2026-05-30", [task({ text: "Once moved", movedAt: "x" })]), // only 1 day
      ],
      "2026-05-30",
    );
    expect(review.slipped).toHaveLength(1);
    expect(review.slipped[0]).toMatchObject({ jiraKey: "DAD-1", movedCount: 3 });
  });
});
