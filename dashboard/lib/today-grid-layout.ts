import { cloneLayout, verticalCompactor, type LayoutItem, type ResponsiveLayouts } from "react-grid-layout";

export const TODAY_GRID_STORAGE_KEY = "devhub-today-grid-layouts-v8";

export const TODAY_GRID_BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 0 } as const;

export const TODAY_GRID_COLS = { lg: 12, md: 12, sm: 12, xs: 12 } as const;

/** Must match `ResponsiveGridLayout` on the Today dashboard. */
export const TODAY_GRID_ROW_HEIGHT = 20;
export const TODAY_GRID_MARGIN: readonly [number, number] = [10, 10];

export type TodayGridBreakpoint = keyof typeof TODAY_GRID_BREAKPOINTS;

export type TodayGridSlotId =
  | "welcome"
  | "main"
  | "calendar"
  | "jira"
  | "github"
  | "datadog";

/** Stable order when merging persisted layout with defaults. */
export const TODAY_GRID_SLOT_ORDER: TodayGridSlotId[] = [
  "welcome",
  "main",
  "calendar",
  "jira",
  "github",
  "datadog",
];

const TODAY_GRID_SLOT_IDS = new Set<string>(TODAY_GRID_SLOT_ORDER);
const LEGACY_OVERSIZED_HEIGHTS: Partial<Record<TodayGridSlotId, number>> = {
  calendar: 6,
  datadog: 5,
};

/**
 * RGL vertical size in px: `h * rowHeight + (h - 1) * marginY`.
 * Invert to pick the smallest h that fits `contentPx`.
 */
export function contentPxToGridHeight(contentPx: number, rowHeight: number, marginY: number): number {
  if (!Number.isFinite(contentPx) || contentPx <= 0) return 1;
  return Math.max(1, Math.ceil((contentPx + marginY) / (rowHeight + marginY)));
}

/**
 * Apply measured heights (grid rows) and vertically compact each breakpoint.
 */
export function applyHeightPatchAndCompact(
  layouts: ResponsiveLayouts<TodayGridBreakpoint>,
  patch: Partial<Record<TodayGridSlotId, number>>,
): ResponsiveLayouts<TodayGridBreakpoint> {
  if (Object.keys(patch).length === 0) return layouts;
  const bps = Object.keys(TODAY_GRID_BREAKPOINTS) as TodayGridBreakpoint[];
  const out: ResponsiveLayouts<TodayGridBreakpoint> = { ...layouts };
  for (const bp of bps) {
    const cols = TODAY_GRID_COLS[bp];
    const raw = out[bp];
    if (!raw) continue;
    const items = raw.map((item) => {
      const slot = item.i as TodayGridSlotId;
      const nh = patch[slot];
      if (nh == null) return item;
      const minH = item.minH ?? 1;
      const maxH = item.maxH ?? Infinity;
      const h = Math.min(maxH, Math.max(minH, nh));
      return { ...item, h };
    });
    out[bp] = [...verticalCompactor.compact(cloneLayout(items), cols)];
  }
  return out;
}

const LG: LayoutItem[] = [
  { i: "welcome", x: 0, y: 0, w: 12, h: 2, minW: 12, maxW: 12, minH: 2 },
  { i: "datadog", x: 0, y: 0, w: 7, h: 4, minH: 2 },
  { i: "main", x: 0, y: 2, w: 8, h: 18, minW: 5, minH: 6 },
  { i: "calendar", x: 8, y: 2, w: 4, h: 4, minW: 3, minH: 2 },
  { i: "jira", x: 8, y: 0, w: 4, h: 14, minW: 3, minH: 2 },
  { i: "github", x: 8, y: 6, w: 4, h: 8, minW: 3, minH: 2 },
];

const MD: LayoutItem[] = [
  { i: "welcome", x: 0, y: 0, w: 12, h: 2, minW: 12, maxW: 12, minH: 2 },
  { i: "main", x: 0, y: 2, w: 8, h: 16, minW: 5, minH: 6 },
  { i: "calendar", x: 8, y: 2, w: 4, h: 4, minW: 3, minH: 2 },
  { i: "jira", x: 8, y: 6, w: 4, h: 8, minW: 3, minH: 2 },
  { i: "github", x: 8, y: 14, w: 4, h: 6, minW: 3, minH: 2 },
  { i: "datadog", x: 0, y: 18, w: 12, h: 4, minH: 2 },
];

const SM: LayoutItem[] = [
  { i: "welcome", x: 0, y: 0, w: 12, h: 2, minW: 12, maxW: 12, minH: 2 },
  { i: "main", x: 0, y: 2, w: 12, h: 16, minW: 12, minH: 6 },
  { i: "calendar", x: 0, y: 18, w: 12, h: 4, minW: 12, minH: 2 },
  { i: "github", x: 0, y: 22, w: 12, h: 6, minW: 12, minH: 2 },
  { i: "jira", x: 0, y: 28, w: 12, h: 6, minW: 12, minH: 2 },
  { i: "datadog", x: 0, y: 34, w: 12, h: 4, minH: 2 },
];

const XS: LayoutItem[] = SM.map((item) => ({ ...item }));

export const TODAY_GRID_DEFAULT_LAYOUTS: ResponsiveLayouts<TodayGridBreakpoint> = {
  lg: LG,
  md: MD,
  sm: SM,
  xs: XS,
};

function isLayoutItem(v: unknown): v is LayoutItem {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.i === "string" &&
    typeof o.x === "number" &&
    typeof o.y === "number" &&
    typeof o.w === "number" &&
    typeof o.h === "number"
  );
}

function parseLayouts(raw: string | null): ResponsiveLayouts<TodayGridBreakpoint> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const out: Partial<ResponsiveLayouts<TodayGridBreakpoint>> = {};
    for (const bp of Object.keys(TODAY_GRID_BREAKPOINTS) as TodayGridBreakpoint[]) {
      const arr = (parsed as Record<string, unknown>)[bp];
      if (!Array.isArray(arr)) continue;
      const items = arr.filter(isLayoutItem);
      if (items.length > 0) out[bp] = items;
    }
    if (Object.keys(out).length === 0) return null;
    return out as ResponsiveLayouts<TodayGridBreakpoint>;
  } catch {
    return null;
  }
}

export function readTodayGridLayoutsFromStorage(): ResponsiveLayouts<TodayGridBreakpoint> | null {
  if (typeof window === "undefined") return null;
  return parseLayouts(window.localStorage.getItem(TODAY_GRID_STORAGE_KEY));
}

export function writeTodayGridLayoutsToStorage(layouts: ResponsiveLayouts<TodayGridBreakpoint>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TODAY_GRID_STORAGE_KEY, JSON.stringify(layouts));
  } catch {
    // ignore quota / private mode
  }
}

export function preserveHiddenTodayGridLayouts(
  nextVisible: ResponsiveLayouts<TodayGridBreakpoint>,
  previous: ResponsiveLayouts<TodayGridBreakpoint> | null,
): ResponsiveLayouts<TodayGridBreakpoint> {
  if (!previous) return nextVisible;
  const result = {} as ResponsiveLayouts<TodayGridBreakpoint>;
  const bps = Object.keys(TODAY_GRID_BREAKPOINTS) as TodayGridBreakpoint[];

  for (const bp of bps) {
    const next = nextVisible[bp] ?? [];
    const nextIds = new Set(next.map((item) => item.i));
    const hidden = (previous[bp] ?? []).filter((item) => TODAY_GRID_SLOT_IDS.has(item.i) && !nextIds.has(item.i));
    result[bp] = [...next, ...hidden];
  }

  return result;
}

function pickItem(layout: readonly LayoutItem[] | undefined, id: string): LayoutItem | undefined {
  return layout?.find((l) => l.i === id);
}

function normalizeSavedItem(saved: LayoutItem, fallback: LayoutItem): LayoutItem {
  const next = {
    ...saved,
    minW: fallback.minW,
    maxW: fallback.maxW,
    minH: fallback.minH,
    maxH: fallback.maxH,
  };

  const legacyOversizedHeight = LEGACY_OVERSIZED_HEIGHTS[next.i as TodayGridSlotId];
  if (next.i === "datadog" && saved.h === 5) {
    next.h = fallback.h;
  } else if (legacyOversizedHeight === saved.h && fallback.h < saved.h) {
    next.h = fallback.h;
  }

  next.w = Math.max(next.minW ?? 1, Math.min(next.maxW ?? Infinity, next.w));
  next.h = Math.max(next.minH ?? 1, Math.min(next.maxH ?? Infinity, next.h));
  return next;
}

/**
 * Build layouts for the current breakpoint set: only visible slots, preferring
 * persisted positions then falling back to defaults.
 */
export function mergeTodayGridLayouts(
  persisted: ResponsiveLayouts<TodayGridBreakpoint> | null,
  visible: ReadonlySet<TodayGridSlotId>,
): ResponsiveLayouts<TodayGridBreakpoint> {
  const result = {} as ResponsiveLayouts<TodayGridBreakpoint>;
  const bps = Object.keys(TODAY_GRID_BREAKPOINTS) as TodayGridBreakpoint[];
  for (const bp of bps) {
    const persistedBp = persisted?.[bp];
    const defaultBp = TODAY_GRID_DEFAULT_LAYOUTS[bp] ?? [];
    const row: LayoutItem[] = [];
    for (const id of TODAY_GRID_SLOT_ORDER) {
      if (!visible.has(id)) continue;
      const saved = pickItem(persistedBp, id);
      const fallback = pickItem(defaultBp, id);
      const base = saved && fallback ? normalizeSavedItem(saved, fallback) : saved ?? fallback;
      if (!base) continue;
      row.push({ ...base, i: id });
    }
    result[bp] = row.length === 0 ? [] : persistedBp ? row : [...verticalCompactor.compact(cloneLayout(row), TODAY_GRID_COLS[bp])];
  }
  return result;
}
