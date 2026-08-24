import { describe, expect, it } from "vitest";
import { STALE_AFTER_MS, groupAwayFailures, isStale } from "./away-failures";

const HOUR = 60 * 60 * 1000;
const t0 = new Date("2026-08-23T12:00:00Z").getTime();

function failure(script: string, hoursAgo: number, exitCode = 1, runId = `${script}-${hoursAgo}`) {
  return { script, exitCode, startedAt: t0 - hoursAgo * HOUR, runId };
}

describe("groupAwayFailures", () => {
  it("collapses repeated failures of the same script into one row", () => {
    const groups = groupAwayFailures([
      failure("collect_local_skills", 26),
      failure("collect_local_skills", 27),
      failure("collect_local_skills", 28),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ script: "collect_local_skills", count: 3 });
  });

  it("dates a group from its most recent failure, not its first", () => {
    const groups = groupAwayFailures([failure("sync", 40), failure("sync", 3)]);
    expect(groups[0]!.latestAt).toBe(t0 - 3 * HOUR);
    expect(groups[0]!.runId).toBe("sync-3");
  });

  it("treats different exit codes as different problems", () => {
    const groups = groupAwayFailures([
      failure("sync", 2, 1),
      failure("sync", 3, 2),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("orders newest problem first", () => {
    const groups = groupAwayFailures([
      failure("old", 30),
      failure("recent", 1),
      failure("middle", 10),
    ]);
    expect(groups.map((g) => g.script)).toEqual(["recent", "middle", "old"]);
  });

  it("survives a missing exit code", () => {
    const groups = groupAwayFailures([
      { script: "sync", startedAt: t0, runId: "a" },
      { script: "sync", startedAt: t0 - HOUR, runId: "b" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.count).toBe(2);
  });

  it("returns nothing for no failures", () => {
    expect(groupAwayFailures([])).toEqual([]);
  });
});

describe("isStale", () => {
  it("is fresh while something failed inside the last day", () => {
    expect(isStale(groupAwayFailures([failure("sync", 2)]), t0)).toBe(false);
  });

  it("goes stale once the newest failure is over a day old", () => {
    expect(isStale(groupAwayFailures([failure("sync", 30)]), t0)).toBe(true);
  });

  it("takes its cue from the newest failure, not the oldest", () => {
    const groups = groupAwayFailures([failure("old", 90), failure("new", 1)]);
    expect(isStale(groups, t0)).toBe(false);
  });

  it("uses the documented threshold", () => {
    const justInside = groupAwayFailures([
      { script: "s", startedAt: t0 - STALE_AFTER_MS + 1000, runId: "a" },
    ]);
    const justOutside = groupAwayFailures([
      { script: "s", startedAt: t0 - STALE_AFTER_MS - 1000, runId: "b" },
    ]);
    expect(isStale(justInside, t0)).toBe(false);
    expect(isStale(justOutside, t0)).toBe(true);
  });
});
