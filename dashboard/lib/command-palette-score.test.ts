import { describe, expect, it } from "vitest";
import {
  alphanumericCompact,
  compactTokenScore,
  paletteCommandScore,
} from "./command-palette-score";

describe("alphanumericCompact", () => {
  it("strips punctuation and case", () => {
    expect(alphanumericCompact("PTF-34")).toBe("ptf34");
    expect(alphanumericCompact("Go to Notes")).toBe("gotonotes");
  });
});

describe("compactTokenScore", () => {
  it("matches ticket key without hyphen", () => {
    expect(compactTokenScore("PTF34", "PTF-34")).toBe(8000);
    expect(compactTokenScore("ptf34", "PTF-34")).toBe(8000);
  });

  it("does not match reversed digit-first query", () => {
    expect(compactTokenScore("34PTF", "PTF-34")).toBe(0);
  });

  it("matches nav-style labels when typing run-together", () => {
    expect(compactTokenScore("gotonotes", "Go to Notes")).toBeGreaterThan(0);
  });
});

describe("paletteCommandScore", () => {
  it("uses best field across key and summary", () => {
    const s = paletteCommandScore("PTF34", [
      "Fix the widget alignment on mobile",
      "PTF-34",
      "In Progress",
    ]);
    expect(s).toBe(8000);
  });

  it("matches note path segments in one blob", () => {
    const s = paletteCommandScore("learningsfoo", ["Foo", "learnings/foo"]);
    expect(s).toBeGreaterThan(1000);
  });
});
