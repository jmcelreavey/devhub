import { describe, expect, it } from "vitest";
import { pickAutoTier, parseNumstat } from "./auto-tiers";
import { DEFAULT_MODEL_TIERS } from "./model-tiers-shared";

const settings = DEFAULT_MODEL_TIERS; // plan mid, implement mid, verify cheap, draft-pr cheap, review heavy
const mid = { ...settings, steps: { ...settings.steps, review: "mid" as const, "draft-pr": "mid" as const } };

describe("pickAutoTier", () => {
  it("keeps the saved tier with no reason when nothing calls for a change", () => {
    expect(pickAutoTier({ settings, phase: "implement", attempt: 0, round: 0 })).toEqual({ tier: "mid" });
    expect(pickAutoTier({ settings, phase: "plan", attempt: 0, round: 0 })).toEqual({ tier: "mid" });
  });

  it("escalates one step per retry after a failure, capped at heavy", () => {
    expect(pickAutoTier({ settings, phase: "implement", attempt: 1, round: 0 })).toEqual({ tier: "heavy", reason: "Stronger model (mid → heavy): retried after a failed run" });
    expect(pickAutoTier({ settings, phase: "implement", attempt: 3, round: 0 }).tier).toBe("heavy");
  });

  it("escalates a fix round that follows one which didn't clear the bugs, and long finding lists", () => {
    expect(pickAutoTier({ settings, phase: "fix", attempt: 0, round: 1, diff: { lines: 200, files: 6 } })).toEqual({ tier: "mid" });
    expect(pickAutoTier({ settings, phase: "fix", attempt: 0, round: 2, diff: { lines: 200, files: 6 } }).reason).toContain("fix round 2");
    expect(pickAutoTier({ settings, phase: "fix", attempt: 0, round: 1, diff: { lines: 200, files: 6 }, findings: 7 })).toMatchObject({ tier: "heavy", reason: expect.stringContaining("7 problems found") });
  });

  it("goes heavy for a large diff and cheap for a trivial one or the draft-PR step", () => {
    expect(pickAutoTier({ settings: mid, phase: "verify", attempt: 0, round: 0, diff: { lines: 1200, files: 9 } })).toEqual({ tier: "heavy", reason: "Stronger model (mid → heavy): big change (1200 lines, 9 files)" });
    expect(pickAutoTier({ settings: mid, phase: "verify", attempt: 0, round: 0, diff: { lines: 12, files: 1 } })).toEqual({ tier: "cheap", reason: "Lighter model (mid → cheap): small change (12 lines, 1 file)" });
    expect(pickAutoTier({ settings: mid, phase: "draft-pr", attempt: 0, round: 0 })).toEqual({ tier: "cheap", reason: "Lighter model (mid → cheap): opening the draft PR is a small step" });
    // A retried draft PR escalates instead of staying cheap.
    expect(pickAutoTier({ settings: mid, phase: "draft-pr", attempt: 1, round: 0 }).tier).toBe("heavy");
  });
});

describe("pickAutoTier with an unknown diff", () => {
  const settings = { ...DEFAULT_MODEL_TIERS, steps: { ...DEFAULT_MODEL_TIERS.steps, review: "heavy" as const, implement: "mid" as const } };
  it("never drops a review or fix below its tier when the diff is empty, unreadable or missing", () => {
    for (const diff of [null, undefined, { lines: 0, files: 0 }, { lines: Number.NaN, files: 1 }]) {
      expect(pickAutoTier({ settings, phase: "verify", attempt: 0, round: 0, diff })).toEqual({ tier: "heavy" });
      expect(pickAutoTier({ settings, phase: "fix", attempt: 0, round: 1, diff })).toEqual({ tier: "heavy", reason: "Stronger model (mid → heavy): couldn't measure the diff, so it's treated as a big change" });
    }
  });
  it("still goes cheap for a measured trivial diff", () => {
    expect(pickAutoTier({ settings, phase: "verify", attempt: 0, round: 0, diff: { lines: 4, files: 1 } }).tier).toBe("cheap");
  });
});

describe("parseNumstat", () => {
  it("counts files and changed lines, binaries as one", () => {
    expect(parseNumstat("10\t2\tapp/a.tsx\n-\t-\tlogo.png\n3\t0\tlib/b.ts\n")).toEqual({ files: 3, lines: 16 });
    expect(parseNumstat("")).toEqual({ files: 0, lines: 0 });
  });
});
