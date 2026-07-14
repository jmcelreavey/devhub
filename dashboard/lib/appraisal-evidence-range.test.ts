import { describe, expect, it } from "vitest";
import {
  clampEvidenceDays,
  evidenceRangeLabel,
  parseEvidenceDays,
} from "./appraisal-evidence-range";

describe("parseEvidenceDays", () => {
  it("accepts presets and falls back otherwise", () => {
    expect(parseEvidenceDays("7")).toBe(7);
    expect(parseEvidenceDays("14")).toBe(14);
    expect(parseEvidenceDays("30")).toBe(30);
    expect(parseEvidenceDays("90")).toBe(90);
    expect(parseEvidenceDays("12")).toBe(7);
    expect(parseEvidenceDays(null)).toBe(7);
    expect(parseEvidenceDays("nope", 30)).toBe(30);
  });
});

describe("clampEvidenceDays", () => {
  it("clamps to 1–90", () => {
    expect(clampEvidenceDays(7)).toBe(7);
    expect(clampEvidenceDays("45")).toBe(45);
    expect(clampEvidenceDays(0)).toBe(1);
    expect(clampEvidenceDays(200)).toBe(90);
    expect(clampEvidenceDays("x")).toBe(7);
  });
});

describe("evidenceRangeLabel", () => {
  it("formats the header badge", () => {
    expect(evidenceRangeLabel(7)).toBe("LAST 7D");
    expect(evidenceRangeLabel(90)).toBe("LAST 90D");
  });
});
