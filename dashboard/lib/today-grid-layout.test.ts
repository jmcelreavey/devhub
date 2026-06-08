import { describe, expect, it } from "vitest";
import { preserveHiddenTodayGridLayouts, type TodayGridBreakpoint } from "./today-grid-layout";
import type { ResponsiveLayouts } from "react-grid-layout";

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
