import { describe, it, expect } from "vitest";
import { formatDuration } from "./utils";

describe("formatDuration", () => {
  it("clamps non-positive and invalid values to 0m", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(-5)).toBe("0m");
    expect(formatDuration(NaN)).toBe("0m");
  });

  it("shows seconds under a minute", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(1_000)).toBe("1s");
  });

  it("shows whole minutes under an hour", () => {
    expect(formatDuration(60_000)).toBe("1m");
    expect(formatDuration(5 * 60_000)).toBe("5m");
    expect(formatDuration(59 * 60_000)).toBe("59m");
  });

  it("shows hours and minutes past an hour", () => {
    expect(formatDuration(60 * 60_000)).toBe("1h");
    expect(formatDuration(80 * 60_000)).toBe("1h 20m");
    expect(formatDuration(125 * 60_000)).toBe("2h 5m");
  });
});
