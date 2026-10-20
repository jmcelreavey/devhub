import { describe, expect, it } from "vitest";
import { isRank, rankBetween } from "./rank";

describe("rankBetween", () => {
  it("always finds a rank strictly between two others", () => {
    expect(rankBetween()).toBe("i");
    const a = rankBetween(undefined, "i");
    const b = rankBetween("i");
    expect(a < "i" && "i" < b).toBe(true);
    let low = "i";
    const high = "j";
    for (let step = 0; step < 60; step += 1) {
      const mid = rankBetween(low, high);
      expect(isRank(mid)).toBe(true);
      expect(low < mid && mid < high).toBe(true);
      low = mid;
    }
    // Repeatedly inserting at the top keeps going too.
    let top = "i";
    for (let step = 0; step < 60; step += 1) {
      const next = rankBetween(undefined, top);
      expect(next < top && isRank(next)).toBe(true);
      top = next;
    }
  });

  it("ignores bounds that are invalid or out of order", () => {
    expect(rankBetween("x", "b") > "x").toBe(true);
    expect(rankBetween("bad rank!", "b") < "b").toBe(true);
    expect(isRank("a0")).toBe(false);
    expect(isRank("")).toBe(false);
  });
});
