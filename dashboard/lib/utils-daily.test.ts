import { describe, it, expect } from "vitest";
import { dailyNotePath, formatDayLabel } from "./utils";

describe("daily note helpers", () => {
  it("dailyNotePath builds the vault slug", () => {
    expect(dailyNotePath("2026-06-07")).toBe("daily/2026-06-07");
  });

  it("formatDayLabel formats an ISO date", () => {
    expect(formatDayLabel("2026-06-07")).toMatch(/June 7/);
  });
});
