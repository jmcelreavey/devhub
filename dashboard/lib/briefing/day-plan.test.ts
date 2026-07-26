import { describe, it, expect } from "vitest";
import {
  mergeIntervals,
  freeWindowsFrom,
  computeDayPlan,
  formatMinutes,
  formatClock,
  NOMINAL_TASK_MIN,
  WORK_START_HOUR,
} from "@/lib/briefing/day-plan";
import type { CalendarEvent } from "@/lib/google-calendar";
import type { Task } from "@/lib/tasks/storage";

/** Local-time ISO for today at h:m, so toMinutes() reads back what we meant. */
function at(h: number, m = 0): string {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

function ev(startH: number, endH: number, title = "Meeting", isAllDay = false): CalendarEvent {
  return {
    id: `${title}-${startH}`,
    title,
    start: at(startH),
    end: at(endH),
    isAllDay,
  } as CalendarEvent;
}

/** Minute-precision variant, for gap arithmetic that whole hours can't express. */
function evm(sh: number, sm: number, eh: number, em: number, title = "Meeting"): CalendarEvent {
  return {
    id: `${title}-${sh}:${sm}`,
    title,
    start: at(sh, sm),
    end: at(eh, em),
    isAllDay: false,
  } as CalendarEvent;
}

function task(id: string, text: string, done = false): Task {
  return { id, text, done, createdAt: new Date().toISOString() } as Task;
}

describe("mergeIntervals", () => {
  it("merges overlapping ranges so double-booking isn't counted twice", () => {
    expect(mergeIntervals([[540, 600], [570, 630]])).toEqual([[540, 630]]);
  });

  it("merges exactly-adjacent ranges", () => {
    expect(mergeIntervals([[540, 600], [600, 660]])).toEqual([[540, 660]]);
  });

  it("keeps genuinely separate ranges apart", () => {
    expect(mergeIntervals([[540, 600], [700, 730]])).toEqual([[540, 600], [700, 730]]);
  });

  it("drops zero and negative length ranges", () => {
    expect(mergeIntervals([[540, 540], [600, 590]])).toEqual([]);
  });

  it("is order independent", () => {
    expect(mergeIntervals([[700, 730], [540, 600]])).toEqual([[540, 600], [700, 730]]);
  });
});

describe("freeWindowsFrom", () => {
  it("returns the whole working day when nothing is booked", () => {
    const w = freeWindowsFrom([], 540, 1050);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ startMin: 540, endMin: 1050, durationMin: 510 });
  });

  it("splits around a midday meeting", () => {
    const w = freeWindowsFrom([[720, 780]], 540, 1050);
    expect(w.map((x) => [x.startMin, x.endMin])).toEqual([
      [780, 1050], // longest first
      [540, 720],
    ]);
  });

  it("sorts longest first so deep work has an obvious home", () => {
    const w = freeWindowsFrom([[600, 630], [900, 930]], 540, 1050);
    expect(w[0].durationMin).toBeGreaterThanOrEqual(w[1].durationMin);
  });

  it("ignores meetings entirely outside working hours", () => {
    const w = freeWindowsFrom([[0, 120], [1300, 1400]], 540, 1050);
    expect(w).toHaveLength(1);
    expect(w[0].durationMin).toBe(510);
  });

  it("clips a meeting that starts before the working day", () => {
    const w = freeWindowsFrom([[480, 600]], 540, 1050);
    expect(w).toEqual([{ startMin: 600, endMin: 1050, durationMin: 450 }]);
  });

  it("returns nothing when the day is fully booked", () => {
    expect(freeWindowsFrom([[540, 1050]], 540, 1050)).toEqual([]);
  });
});

describe("computeDayPlan", () => {
  it("counts meeting load with overlaps collapsed", () => {
    const plan = computeDayPlan([ev(10, 11), ev(10, 12)], [], []);
    expect(plan.meetingCount).toBe(2);
    expect(plan.meetingMinutes).toBe(120); // not 180
  });

  it("separates all-day entries from meeting load", () => {
    const plan = computeDayPlan([ev(0, 0, "Public holiday", true), ev(10, 11)], [], []);
    expect(plan.allDayTitles).toEqual(["Public holiday"]);
    expect(plan.meetingCount).toBe(1);
    expect(plan.meetingMinutes).toBe(60);
  });

  it("only counts open tasks", () => {
    const plan = computeDayPlan([], [task("1", "a"), task("2", "b", true)], []);
    expect(plan.openTasks.map((t) => t.id)).toEqual(["1"]);
  });

  it("fits fewer tasks on a heavily booked day than a free one", () => {
    const tasks = [task("1", "a"), task("2", "b"), task("3", "c"), task("4", "d")];
    const free = computeDayPlan([], tasks, []);
    const busy = computeDayPlan([ev(WORK_START_HOUR, 17)], tasks, []);
    expect(busy.tasksThatFit).toBeLessThan(free.tasksThatFit);
    expect(busy.tasksThatFit).toBe(0);
  });

  it("never claims more tasks fit than exist", () => {
    const plan = computeDayPlan([], [task("1", "only one")], []);
    expect(plan.tasksThatFit).toBe(1);
  });

  it("does not let a task span a meeting", () => {
    // Free time is 30m + 30m = 60m, which exceeds the 45m nominal task cost.
    // But neither window holds a whole task, so nothing fits. This is the
    // reason capacity is computed per window rather than by dividing the total.
    const plan = computeDayPlan(
      [evm(9, 30, 12, 0), evm(12, 30, 17, 30)],
      [task("1", "a")],
      [],
    );
    expect(plan.freeMinutes).toBeGreaterThan(NOMINAL_TASK_MIN);
    expect(plan.longestFreeMin).toBeLessThan(NOMINAL_TASK_MIN);
    expect(plan.tasksThatFit).toBe(0);
  });

  it("passes recent failures through for the 'it broke at 3am' line", () => {
    const plan = computeDayPlan([], [], [
      { runId: "r", script: "nightly_sync", startedAt: 123, exitCode: 1, ok: false },
    ]);
    expect(plan.recentFailures).toEqual([
      { script: "nightly_sync", exitCode: 1, startedAt: 123 },
    ]);
  });

  it("produces a usable plan when every source is empty", () => {
    const plan = computeDayPlan([], [], []);
    expect(plan.meetingMinutes).toBe(0);
    expect(plan.openTasks).toEqual([]);
    expect(plan.recentFailures).toEqual([]);
    expect(plan.longestFreeMin).toBeGreaterThan(0);
  });
});

describe("formatting", () => {
  it.each([
    [0, "0m"],
    [-5, "0m"],
    [45, "45m"],
    [60, "1h"],
    [200, "3h 20m"],
  ])("formatMinutes(%i) -> %s", (min, expected) => {
    expect(formatMinutes(min)).toBe(expected);
  });

  it.each([
    [540, "09:30".replace("30", "00")],
    [570, "09:30"],
    [0, "00:00"],
  ])("formatClock(%i) -> %s", (min, expected) => {
    expect(formatClock(min)).toBe(expected);
  });
});
