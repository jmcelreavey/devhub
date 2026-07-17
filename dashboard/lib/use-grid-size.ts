import { createContext, useContext } from "react";
import type { ResponsiveLayouts } from "react-grid-layout";
import { TODAY_GRID_BREAKPOINTS, type TodayGridBreakpoint, type TodayGridSlotId } from "@/lib/today-grid-layout";

/** Abstract size tier for a grid card. Thresholds tuned to the 12-column grid. */
export type GridSizeCategory = "1x1" | "2x1" | "3x1" | "3x2" | "default";

interface GridDims { w: number; h: number; }
export type GridSizeMap = Partial<Record<TodayGridSlotId, GridDims>>;

export const GridSizeContext = createContext<GridSizeMap>({});

/** Map raw grid w×h to an abstract size tier. */
export function categorizeGridSize(w: number, h: number): GridSizeCategory {
  // Short tiles clip multi-row heroes — collapse before width-based "wide" tiers.
  if (w <= 4 || h <= 3) return "1x1";
  if (w >= 10 && h >= 6) return "3x2";
  if (w >= 10) return "3x1";
  if (h >= 6) return "default";
  return "2x1";
}

/** Read the current size tier for a grid slot. Returns "default" outside a grid context. */
export function useGridSize(slotId: TodayGridSlotId): GridSizeCategory {
  const map = useContext(GridSizeContext);
  const dims = map[slotId];
  if (!dims) return "default";
  return categorizeGridSize(dims.w, dims.h);
}

/** Derive a size map from the active breakpoint's layout. */
export function deriveSizeMap(
  layouts: ResponsiveLayouts<TodayGridBreakpoint>,
  containerWidth: number,
): GridSizeMap {
  const sorted = (Object.entries(TODAY_GRID_BREAKPOINTS) as [TodayGridBreakpoint, number][])
    .sort(([, a], [, b]) => b - a);
  const bp = sorted.find(([, minW]) => containerWidth >= minW)?.[0] ?? "xs";
  const map: GridSizeMap = {};
  for (const item of layouts[bp] ?? []) {
    map[item.i as TodayGridSlotId] = { w: item.w, h: item.h };
  }
  return map;
}
