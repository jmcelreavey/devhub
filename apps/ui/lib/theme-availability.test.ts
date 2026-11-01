import { describe, expect, it } from "vitest";
import { isThemeAvailable, type ThemeAvailability } from "./theme-availability";
import { themeAvailabilitySchema } from "../../../packages/shared/ui-lib/plugins/theme-availability-schema";

function localDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

describe("seasonal theme availability", () => {
  const halloween = { type: "fixed", start: { month: 10, day: 1 }, end: { month: 10, day: 31 } } as const;
  const newYear = { type: "fixed", start: { month: 12, day: 30 }, end: { month: 1, day: 2 } } as const;
  const easter = { type: "easter", offsetStart: -3, offsetEnd: 3 } as const;

  it.each([
    ["2026-09-30", false], ["2026-10-01", true], ["2026-10-31", true], ["2026-11-01", false],
  ])("uses inclusive local dates for Halloween: %s", (date, expected) => {
    expect(isThemeAvailable(halloween, localDate(date))).toBe(expected);
  });

  it.each([
    ["2026-12-29", false], ["2026-12-30", true], ["2026-12-31", true],
    ["2027-01-01", true], ["2027-01-02", true], ["2027-01-03", false],
  ])("handles year-spanning windows: %s", (date, expected) => {
    expect(isThemeAvailable(newYear, localDate(date))).toBe(expected);
  });

  it.each(["2023-04-09", "2024-03-31", "2025-04-20", "2026-04-05", "2027-03-28", "2038-04-25"])(
    "calculates Western Easter on %s", date => {
      expect(isThemeAvailable({ type: "easter", offsetStart: 0, offsetEnd: 0 }, localDate(date))).toBe(true);
    },
  );

  it.each([
    ["2026-04-01", false], ["2026-04-02", true], ["2026-04-05", true],
    ["2026-04-08", true], ["2026-04-09", false],
  ])("handles Easter boundaries across daylight-saving changes: %s", (date, expected) => {
    expect(isThemeAvailable(easter, localDate(date))).toBe(expected);
  });

  it("keeps ordinary presets available and fails closed for invalid windows", () => {
    expect(isThemeAvailable(undefined, localDate("2026-03-17"))).toBe(true);
    for (const invalid of [null, {}, { type: "unknown" }, { type: "fixed", start: null, end: halloween.end },
      { type: "fixed", start: { month: 2, day: 30 }, end: halloween.end },
      { type: "easter", offsetStart: 4, offsetEnd: -4 }, { type: "easter", offsetStart: -61, offsetEnd: 2 }]) {
      expect(isThemeAvailable(invalid as ThemeAvailability, localDate("2026-03-17"))).toBe(false);
    }
    expect(isThemeAvailable(halloween, new Date("invalid"))).toBe(false);
  });

  it("strictly validates dates, offsets and unknown fields", () => {
    for (const valid of [halloween, newYear, easter,
      { type: "fixed", start: { month: 2, day: 29 }, end: { month: 3, day: 1 } }]) {
      expect(themeAvailabilitySchema.safeParse(valid).success).toBe(true);
    }
    for (const invalid of [
      { ...halloween, extra: true }, { ...halloween, start: { month: 2, day: 30 } },
      { ...halloween, start: { month: 13, day: 1 } }, { ...easter, offsetStart: -61 },
      { ...easter, offsetEnd: 61 }, { ...easter, offsetStart: 0.5 },
      { ...easter, offsetStart: 4, offsetEnd: 3 }, { type: "arbitrary" },
    ]) {
      expect(themeAvailabilitySchema.safeParse(invalid).success).toBe(false);
    }
  });
});
