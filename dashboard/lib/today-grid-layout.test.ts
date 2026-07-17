import { describe, expect, it } from "vitest";
import {
  mergeTodayGridLayouts,
  preserveHiddenTodayGridLayouts,
  TODAY_GRID_DEFAULT_LAYOUTS,
  type TodayGridBreakpoint,
  type TodayGridSlotId,
} from "./today-grid-layout";
import type { ResponsiveLayouts } from "react-grid-layout";
import { categorizeGridSize } from "./use-grid-size";

function layouts(
  items: ResponsiveLayouts<TodayGridBreakpoint>[TodayGridBreakpoint],
): ResponsiveLayouts<TodayGridBreakpoint> {
  return { lg: items, md: items, sm: items, xs: items };
}

describe("preserveHiddenTodayGridLayouts", () => {
  it("keeps saved layouts for cards absent from the visible layout", () => {
    const previous = layouts([
      { i: "main", x: 0, y: 0, w: 7, h: 12 },
      { i: "calendar", x: 7, y: 0, w: 5, h: 6 },
    ]);
    const nextVisible = layouts([{ i: "main", x: 0, y: 0, w: 8, h: 10 }]);

    const merged = preserveHiddenTodayGridLayouts(nextVisible, previous);

    expect(merged.lg).toEqual([
      { i: "main", x: 0, y: 0, w: 8, h: 10 },
      { i: "calendar", x: 7, y: 0, w: 5, h: 6 },
    ]);
  });
});

describe("mergeTodayGridLayouts briefing height", () => {
  it("lifts legacy short briefing tiles to the hero-capable default", () => {
    const persisted = layouts([
      { i: "briefing", x: 0, y: 0, w: 12, h: 3, minW: 4, minH: 2 },
      { i: "main", x: 0, y: 3, w: 8, h: 12, minW: 5, minH: 6 },
    ]);
    const visible = new Set<TodayGridSlotId>(["briefing", "main"]);
    const merged = mergeTodayGridLayouts(persisted, visible);
    const briefing = merged.lg?.find((item) => item.i === "briefing");
    const fallback = TODAY_GRID_DEFAULT_LAYOUTS.lg?.find((item) => item.i === "briefing");
    expect(briefing?.h).toBe(fallback?.h);
    expect(briefing?.minH).toBe(fallback?.minH);
  });
});

describe("categorizeGridSize", () => {
  it("treats short tiles as compact even when wide", () => {
    expect(categorizeGridSize(12, 3)).toBe("1x1");
    expect(categorizeGridSize(12, 6)).toBe("3x2");
    expect(categorizeGridSize(12, 5)).toBe("3x1");
  });
});
