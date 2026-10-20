import { describe, expect, it } from "vitest";
import { autoProgress } from "./auto-phase";

describe("autoProgress", () => {
  it("says where auto mode is in one plain line", () => {
    expect(autoProgress({ phase: "plan", round: 0, maxRounds: 2 })).toBe("Auto · Planning (1/5)");
    expect(autoProgress({ phase: "verify", round: 0, maxRounds: 2 })).toBe("Auto · Reviewing (4/5)");
    expect(autoProgress({ phase: "fix", round: 1, maxRounds: 2 })).toBe("Auto · Fixing, round 1 of 2 (4/5)");
    expect(autoProgress({ phase: "ready", round: 2, maxRounds: 2 })).toBe("Auto · Ready for review (5/5)");
    expect(autoProgress({ phase: "something-new", round: 0, maxRounds: 2 })).toBe("Auto");
  });

  it("uses the orchestration status when no waiting record exists", () => {
    expect(autoProgress({ phase: "plan", round: 0, maxRounds: 2, status: "paused" })).toBe("Auto · Planning (1/5) · paused");
    expect(autoProgress({ phase: "implement", round: 0, maxRounds: 2, status: "paused-manual" })).toBe("Manual · Building (2/5)");
  });

  it("says when it is paused or waiting for a slot", () => {
    expect(autoProgress({ phase: "implement", round: 0, maxRounds: 2, waiting: { kind: "failure" } })).toBe("Auto · Building (2/5) · paused");
    expect(autoProgress({ phase: "implement", round: 0, maxRounds: 2, waiting: { kind: "queued" } })).toBe("Auto · Building (2/5) · waiting for a free slot");
  });
});
