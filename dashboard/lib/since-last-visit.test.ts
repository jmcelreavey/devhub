import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildAwayDigest } from "@/lib/since-last-visit";
import type { RunHistoryRow } from "@/lib/run-history";

const listRecentRuns = vi.hoisted(() => vi.fn());
vi.mock("@/lib/run-history", () => ({ listRecentRuns }));

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

function run(over: Partial<RunHistoryRow>): RunHistoryRow {
  return {
    runId: "r",
    script: "sync",
    startedAt: NOW - HOUR,
    finishedAt: NOW - HOUR + 1000,
    exitCode: 0,
    ok: true,
    ...over,
  };
}

beforeEach(() => listRecentRuns.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("buildAwayDigest", () => {
  it("reports a quiet window when nothing ran", () => {
    listRecentRuns.mockReturnValue([]);
    const d = buildAwayDigest(NOW - 24 * HOUR, NOW);
    expect(d.quiet).toBe(true);
    expect(d.failedRuns).toEqual([]);
    expect(d.succeededCount).toBe(0);
  });

  it("separates failures from successes", () => {
    listRecentRuns.mockReturnValue([
      run({ runId: "a", ok: false, exitCode: 1, script: "backup" }),
      run({ runId: "b" }),
      run({ runId: "c" }),
    ]);
    const d = buildAwayDigest(NOW - 24 * HOUR, NOW);
    expect(d.failedRuns.map((f) => f.script)).toEqual(["backup"]);
    expect(d.succeededCount).toBe(2);
    expect(d.quiet).toBe(false);
  });

  it("excludes runs that finished before the window", () => {
    listRecentRuns.mockReturnValue([
      run({ runId: "old", startedAt: NOW - 50 * HOUR, finishedAt: NOW - 49 * HOUR }),
      run({ runId: "new" }),
    ]);
    const d = buildAwayDigest(NOW - 24 * HOUR, NOW);
    expect(d.succeededCount).toBe(1);
  });

  it("keys the window on when a run FINISHED, not when it started", () => {
    // A job that starts Friday evening and fails Saturday morning is weekend
    // news. Keying off startedAt would file it under Friday and hide it.
    listRecentRuns.mockReturnValue([
      run({
        runId: "overnight",
        ok: false,
        exitCode: 1,
        startedAt: NOW - 30 * HOUR,
        finishedAt: NOW - 2 * HOUR,
      }),
    ]);
    const d = buildAwayDigest(NOW - 24 * HOUR, NOW);
    expect(d.failedRuns).toHaveLength(1);
  });

  it("falls back to startedAt for a run that never recorded a finish", () => {
    listRecentRuns.mockReturnValue([
      run({ runId: "hung", finishedAt: undefined, startedAt: NOW - 2 * HOUR }),
    ]);
    expect(buildAwayDigest(NOW - 24 * HOUR, NOW).succeededCount).toBe(1);
  });

  it("clamps an absurd window so a corrupt timestamp can't scan all history", () => {
    listRecentRuns.mockReturnValue([]);
    const d = buildAwayDigest(0, NOW);
    expect(d.since).toBeGreaterThan(NOW - 31 * 24 * HOUR);
  });

  it("passes a future timestamp through without inverting the window", () => {
    listRecentRuns.mockReturnValue([run({})]);
    const d = buildAwayDigest(NOW + 10 * HOUR, NOW);
    expect(d.since).toBe(NOW + 10 * HOUR);
    expect(d.quiet).toBe(true);
  });
});
