import { describe, expect, it } from "vitest";
import { describeUpdate, latestUpdates, updateTimeline } from "./timeline";
import type { WorkflowEvent } from "./types";

let seq = 0;
const ev = (at: string, summary: string): WorkflowEvent => ({ id: `e${(seq += 1)}`, at, summary });

const events = [
  ev("2026-10-16T12:51:00Z", "review run: starting"),
  ev("2026-10-16T12:52:00Z", "review run: running"),
  ev("2026-10-16T13:04:00Z", "review run: completed"),
  ev("2026-10-16T13:04:01Z", "review run: completed"),
  ev("2026-10-16T13:06:00Z", "Verification started"),
  ev("2026-10-16T13:06:05Z", "Verification command started"),
  ev("2026-10-16T13:07:00Z", "Verification passed"),
  ev("2026-10-17T09:00:00Z", "Verification started"),
  ev("2026-10-17T09:01:00Z", "Evidence changed or verification was interrupted"),
  ev("2026-10-17T09:02:00Z", "Review requires changes"),
];

describe("workflow updates", () => {
  it("says raw events in plain words", () => {
    expect(describeUpdate("review run: completed")).toEqual({ text: "Review run finished", tone: "ok" });
    expect(describeUpdate("implement run: needs-attention")).toEqual({ text: "Implement run needs attention", tone: "warn" });
    expect(describeUpdate("Verification command started").text).toBe("Running the checks");
    expect(describeUpdate("Evidence changed or verification was interrupted").tone).toBe("warn");
    expect(describeUpdate("Something new")).toEqual({ text: "Something new", tone: "neutral" });
  });

  it("shows the latest few, newest first, folding consecutive repeats", () => {
    const latest = latestUpdates(events, 4).map((line) => line.text);
    expect(latest).toEqual(["Review asked for changes", "Verification interrupted: the code changed, so it needs another run", "Verification started", "Checks passed"]);
    expect(latestUpdates(events, 10).filter((line) => line.text === "Review run finished")).toHaveLength(1);
  });

  it("groups the timeline by run and verification pass, then by day, newest first", () => {
    const days = updateTimeline(events);
    expect(days.map((day) => day.day)).toEqual(["2026-10-17", "2026-10-16"]);
    const [today, yesterday] = days;
    expect(today!.groups.map((group) => [group.label, group.outcome, group.tone])).toEqual([
      ["Review asked for changes", undefined, "warn"],
      ["Verification", "interrupted", "warn"],
    ]);
    expect(yesterday!.groups.map((group) => [group.label, group.outcome, group.tone, group.events.length])).toEqual([
      ["Verification", "passed", "ok", 3],
      ["Review run", "finished", "ok", 3],
    ]);
    const review = yesterday!.groups[1]!;
    expect(review.start).toBe("2026-10-16T12:51:00Z");
    expect(review.end).toBe("2026-10-16T13:04:01Z");
  });

  it("starts a new group for each new run of the same role", () => {
    const days = updateTimeline([ev("2026-10-16T10:00:00Z", "implement run: starting"), ev("2026-10-16T10:05:00Z", "implement run: failed"), ev("2026-10-16T10:06:00Z", "implement run: starting"), ev("2026-10-16T10:09:00Z", "implement run: completed")]);
    expect(days[0]!.groups.map((group) => group.outcome)).toEqual(["finished", "failed"]);
  });
});
