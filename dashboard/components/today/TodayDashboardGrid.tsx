"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { GridSizeContext, deriveSizeMap } from "@/lib/hooks/use-grid-size";
import {
  ResponsiveGridLayout,
  useContainerWidth,
  verticalCompactor,
  type Layout,
  type ResponsiveLayouts,
} from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import type { LayoutItem } from "react-grid-layout";
import "react-resizable/css/styles.css";
import { ResizeHandle } from "@/components/shell/ResizeHandle";
import {
  applyCollapsedHeights,
  applyHeightPatchAndCompact,
  contentPxToGridHeight,
  mergeTodayGridLayouts,
  preserveHiddenTodayGridLayouts,
  readTodayGridLayoutsFromStorage,
  writeTodayGridLayoutsToStorage,
  TODAY_GRID_BREAKPOINTS,
  TODAY_GRID_COLLAPSED_HEIGHT,
  TODAY_GRID_COLS,
  TODAY_GRID_MARGIN,
  TODAY_GRID_ROW_HEIGHT,
  TODAY_GRID_SLOT_ORDER,
  type TodayGridBreakpoint,
  type TodayGridSlotId,
} from "@/lib/today/grid-layout";

export interface TodayDashboardSlots {
  welcome: React.ReactNode;
  briefing: React.ReactNode;
  main: React.ReactNode;
  calendar: React.ReactNode;
  jira: React.ReactNode;
  github: React.ReactNode;
  datadog: React.ReactNode;
}

export interface TodayDashboardGridProps {
  ready?: boolean;
  showWelcome: boolean;
  showBriefing: boolean;
  hasCalendar: boolean;
  hasJira: boolean;
  hasGithub: boolean;
  showDatadog: boolean;
  collapsedSlots: ReadonlySet<TodayGridSlotId>;
  slots: TodayDashboardSlots;
}

function buildVisibleSet(props: Pick<TodayDashboardGridProps, "showWelcome" | "showBriefing" | "hasCalendar" | "hasJira" | "hasGithub" | "showDatadog">): Set<TodayGridSlotId> {
  const s = new Set<TodayGridSlotId>(["main"]);
  if (props.showWelcome) s.add("welcome");
  if (props.showBriefing) s.add("briefing");
  if (props.hasCalendar) s.add("calendar");
  if (props.hasJira) s.add("jira");
  if (props.hasGithub) s.add("github");
  if (props.showDatadog) s.add("datadog");
  return s;
}

interface TodayDashboardGridBodyProps {
  width: number;
  visibleKey: string;
  visible: ReadonlySet<TodayGridSlotId>;
  collapsedKey: string;
  collapsedSlots: ReadonlySet<TodayGridSlotId>;
  slots: TodayDashboardSlots;
  ready: boolean;
}

/**
 * The content's *natural* height, with the grid's imposed height removed.
 *
 * The obvious version of this — read `scrollHeight` and be done — is circular
 * and was the actual bug behind "collapsing hides the text but the card stays
 * the same size". `.react-resizable` is `height: 100%` and react-grid-layout
 * sets the slot's height explicitly, so a child that wants 80px inside a
 * 300px slot reports 300. The measurement can only ever return what the layout
 * already decided, so a collapsed card never shrinks.
 *
 * Worse, it drifts: each pass adds the `+ 8` padding to a value that already
 * included it, so every collapse/expand cycle made the card slightly taller.
 * That was the second symptom, and it is the giveaway that the measurement was
 * reading its own output.
 *
 * So the constraint is lifted for the duration of the read. Setting `height`
 * to `auto` and touching `scrollHeight` forces a synchronous reflow, which is
 * the cost of getting a real answer; it happens only when a card is collapsed
 * or expanded, not on every render.
 */
function measureSlotContentPx(slot: HTMLDivElement): number {
  const target = slot.firstElementChild instanceof HTMLElement ? slot.firstElementChild : slot;

  const previousHeight = target.style.height;
  const previousMinHeight = target.style.minHeight;
  const previousFlex = target.style.flex;
  target.style.height = "auto";
  target.style.minHeight = "0";
  target.style.flex = "none";

  // Reading scrollHeight flushes layout, so the value below reflects the
  // unconstrained box rather than the one we just replaced.
  const natural = Math.ceil(
    Math.max(target.scrollHeight, target.getBoundingClientRect().height),
  );

  target.style.height = previousHeight;
  target.style.minHeight = previousMinHeight;
  target.style.flex = previousFlex;

  return natural;
}

/**
 * Run after the browser has actually laid out, not merely after the next frame.
 *
 * A single `requestAnimationFrame` fires *before* WebKit has finished reflow
 * for the DOM change React just committed, so `scrollHeight` still reports the
 * previous size. In the desktop app — which renders in WKWebView — that made
 * collapsing a card leave the grid slot at its full height: the content hid,
 * the card did not shrink. Expanding then measured a half-settled layout and
 * came back slightly taller each time.
 *
 * Two frames is the standard idiom for "after style and layout have been
 * recalculated". Chromium tolerated one, which is why this only showed up
 * after the move off Electron.
 */
function afterLayout(fn: () => void): () => void {
  let inner = 0;
  const outer = requestAnimationFrame(() => {
    inner = requestAnimationFrame(fn);
  });
  return () => {
    cancelAnimationFrame(outer);
    if (inner) cancelAnimationFrame(inner);
  };
}

/**
 * Merge persisted layout, then force collapsed slots to the header height.
 *
 * `normalizeSavedItem` lifts short briefing/calendar tiles and clamps to
 * `minH`, so a remount would otherwise paint collapsed cards at expanded `h`.
 */
function mergeVisibleLayouts(
  persisted: ResponsiveLayouts<TodayGridBreakpoint> | null,
  visible: ReadonlySet<TodayGridSlotId>,
  collapsedSlots: ReadonlySet<TodayGridSlotId>,
): ResponsiveLayouts<TodayGridBreakpoint> {
  return applyCollapsedHeights(mergeTodayGridLayouts(persisted, visible), collapsedSlots);
}

function heightForSlot(
  layouts: ResponsiveLayouts<TodayGridBreakpoint>,
  id: TodayGridSlotId,
): number | null {
  for (const items of Object.values(layouts)) {
    const found = (items as readonly LayoutItem[] | undefined)?.find((it) => it.i === id);
    if (found) return found.h;
  }
  return null;
}

function querySlotElement(id: TodayGridSlotId): HTMLDivElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLDivElement>(`[data-today-grid-slot="${id}"]`);
}

/**
 * Isolated so `key={visibleKey}` on the parent can remount and re-run
 * `useState` initializers when visible tiles change (no setState-in-effect).
 */
function TodayDashboardGridBody({
  width,
  visibleKey,
  visible,
  collapsedKey,
  collapsedSlots,
  slots,
  ready,
}: TodayDashboardGridBodyProps) {
  const [layouts, setLayouts] = useState<ResponsiveLayouts<TodayGridBreakpoint>>(() =>
    mergeVisibleLayouts(readTodayGridLayoutsFromStorage(), visible, collapsedSlots),
  );
  const layoutsRef = useRef(layouts);
  useLayoutEffect(() => {
    layoutsRef.current = layouts;
  });

  const slotRefs = useRef<Partial<Record<TodayGridSlotId, HTMLDivElement | null>>>({});
  const contentAutoLayoutDoneRef = useRef(false);
  const previousCollapsedRef = useRef<ReadonlySet<TodayGridSlotId> | null>(null);
  /**
   * The height each card had before it was collapsed.
   *
   * Expanding used to re-measure the natural content height, which is not the
   * same thing as "the size it was". If the user had resized a card, or the
   * content had since changed, it came back a different size and left a hole in
   * the grid. Remembering is both simpler and what people actually expect from
   * a minimise control.
   */
  const heightBeforeCollapseRef = useRef<Partial<Record<TodayGridSlotId, number>>>({});
  const settledRef = useRef(false);

  const setSlotRef = useCallback((id: TodayGridSlotId) => (el: HTMLDivElement | null) => {
    slotRefs.current[id] = el;
  }, []);

  useLayoutEffect(() => {
    if (ready) settledRef.current = true;
  }, [ready]);

  // Listen for preset-apply events from LayoutPresetsButton
  useEffect(() => {
    const onApply = () => {
      const saved = readTodayGridLayoutsFromStorage();
      if (saved) setLayouts(mergeVisibleLayouts(saved, visible, collapsedSlots));
    };
    window.addEventListener("devhub:grid-preset-apply", onApply);
    return () => window.removeEventListener("devhub:grid-preset-apply", onApply);
  }, [visible, collapsedSlots]);

  useLayoutEffect(() => {
    if (!settledRef.current) return;
    writeTodayGridLayoutsToStorage(preserveHiddenTodayGridLayouts(layouts, readTodayGridLayoutsFromStorage()));
    // Normalize persisted constraints once after `mergeTodayGridLayouts` upgrades older saved layouts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey]);

  useLayoutEffect(() => {
    if (contentAutoLayoutDoneRef.current) return;
    if (readTodayGridLayoutsFromStorage()) {
      contentAutoLayoutDoneRef.current = true;
      return;
    }
    contentAutoLayoutDoneRef.current = true;

    const cancel = afterLayout(() => {
      const marginY = TODAY_GRID_MARGIN[1];
      const rh = TODAY_GRID_ROW_HEIGHT;
      const patch: Partial<Record<TodayGridSlotId, number>> = {};
      for (const id of TODAY_GRID_SLOT_ORDER) {
        if (!visible.has(id)) continue;
        if (collapsedSlots.has(id)) {
          patch[id] = TODAY_GRID_COLLAPSED_HEIGHT;
          continue;
        }
        const el = slotRefs.current[id] ?? querySlotElement(id);
        if (!el) continue;
        const px = measureSlotContentPx(el);
        patch[id] = contentPxToGridHeight(px + 8, rh, marginY);
      }
      if (Object.keys(patch).length === 0) return;
      setLayouts((prev) => {
        const next = applyHeightPatchAndCompact(prev, patch, collapsedSlots);
        if (settledRef.current) {
          writeTodayGridLayoutsToStorage(preserveHiddenTodayGridLayouts(next, readTodayGridLayoutsFromStorage()));
        }
        return next;
      });
    });
    return cancel;
  }, [visibleKey, visible, collapsedSlots]);

  const onLayoutChange = useCallback((_layout: Layout, all: ResponsiveLayouts<TodayGridBreakpoint>) => {
    setLayouts(all);
    if (settledRef.current) {
      writeTodayGridLayoutsToStorage(preserveHiddenTodayGridLayouts(all, readTodayGridLayoutsFromStorage()));
    }
  }, []);

  useLayoutEffect(() => {
    const previous = previousCollapsedRef.current;
    previousCollapsedRef.current = new Set(collapsedSlots);

    // First paint already applied collapsed heights from `collapsedSlots`.
    // Treating "currently collapsed" as a transition would remember the
    // collapsed `h` as the restore height.
    if (previous == null) return;

    const cancel = afterLayout(() => {
      const marginY = TODAY_GRID_MARGIN[1];
      const patch: Partial<Record<TodayGridSlotId, number>> = {};
      const collapsing = new Set<TodayGridSlotId>();
      for (const id of TODAY_GRID_SLOT_ORDER) {
        if (!visible.has(id)) continue;
        const isCollapsed = collapsedSlots.has(id);
        if (previous.has(id) === isCollapsed) continue;
        const el = slotRefs.current[id] ?? querySlotElement(id);
        if (!el) continue;

        if (isCollapsed) {
          // Remember the size to come back to, then shrink to the header.
          const current = heightForSlot(layoutsRef.current, id);
          if (current != null) heightBeforeCollapseRef.current[id] = current;
          patch[id] = TODAY_GRID_COLLAPSED_HEIGHT;
          // The briefing and tasks cards declare minH: 6, which would otherwise
          // hold them at six rows while every other card collapses to three.
          collapsing.add(id);
          continue;
        }

        /*
         * Expanding: restore the remembered height rather than re-measuring.
         *
         * Re-measuring produced two visible faults — cards came back a
         * different size than they were, and collapsed cards ended up at
         * assorted heights depending on how much summary text each one showed.
         * Neither is what a minimise control should do.
         */
        const remembered = heightBeforeCollapseRef.current[id];
        if (remembered != null) {
          patch[id] = remembered;
          delete heightBeforeCollapseRef.current[id];
          continue;
        }
        // No memory (collapsed before this session): fall back to measuring.
        const px = measureSlotContentPx(el);
        patch[id] = contentPxToGridHeight(px + 8, TODAY_GRID_ROW_HEIGHT, marginY);
      }
      if (Object.keys(patch).length === 0) return;
      setLayouts((prev) => {
        const next = applyHeightPatchAndCompact(prev, patch, collapsing);
        if (settledRef.current) {
          writeTodayGridLayoutsToStorage(preserveHiddenTodayGridLayouts(next, readTodayGridLayoutsFromStorage()));
        }
        return next;
      });
    });
    return cancel;
    // Intentionally omit `layouts`: a remount fires `onLayoutChange`, which
    // used to retrigger this effect and cancel the collapse patch mid-flight.
  }, [collapsedKey, collapsedSlots, visible]);

  const rowHeight = TODAY_GRID_ROW_HEIGHT;
  const margin = TODAY_GRID_MARGIN;

  const sizeMap = useMemo(() => deriveSizeMap(layouts, width), [layouts, width]);

  useEffect(() => () => document.body.removeAttribute("data-grid-resizing"), []);

  return (
    <GridSizeContext.Provider value={sizeMap}>
    <ResponsiveGridLayout
      className="layout"
      width={width}
      layouts={layouts}
      breakpoints={TODAY_GRID_BREAKPOINTS}
      cols={TODAY_GRID_COLS}
      rowHeight={rowHeight}
      margin={[...margin]}
      containerPadding={[0, 0]}
      autoSize
      compactor={verticalCompactor}
      onLayoutChange={onLayoutChange}
      onResizeStart={() => document.body.setAttribute("data-grid-resizing", "true")}
      onResizeStop={() => document.body.removeAttribute("data-grid-resizing")}
      dragConfig={{
        enabled: true,
        handle: ".today-grid-drag-handle",
        cancel:
          "button, a, input, textarea, select, [contenteditable='true'], .today-grid-drag-cancel, .react-resizable-handle",
        threshold: 6,
      }}
      resizeConfig={{
        enabled: true,
        handles: ["se", "s", "e"],
        handleComponent: (axis, ref) => {
          const style: React.CSSProperties =
            axis === "e"
              ? { position: "absolute", top: 0, right: 0, bottom: 0, width: 6, height: "100%" }
              : axis === "s"
                ? { position: "absolute", left: 0, right: 0, bottom: 0, height: 6, width: "100%" }
                : { position: "absolute", bottom: 0, right: 0, width: 12, height: 12 };
          return (
            <ResizeHandle
              axis={axis as "e" | "s" | "se"}
              ref={ref as React.Ref<HTMLDivElement>}
              style={style}
            />
          );
        },
      }}
    >
      {visible.has("welcome") ? (
        <div key="welcome" ref={setSlotRef("welcome")} className="today-grid-slot" data-today-grid-slot="welcome">
          {slots.welcome}
        </div>
      ) : null}
      {visible.has("briefing") ? (
        <div key="briefing" ref={setSlotRef("briefing")} className="today-grid-slot" data-today-grid-slot="briefing">
          {slots.briefing}
        </div>
      ) : null}
      <div key="main" ref={setSlotRef("main")} className="today-grid-slot" data-today-grid-slot="main">
        {slots.main}
      </div>
      {visible.has("calendar") ? (
        <div key="calendar" ref={setSlotRef("calendar")} className="today-grid-slot" data-today-grid-slot="calendar">
          {slots.calendar}
        </div>
      ) : null}
      {visible.has("jira") ? (
        <div key="jira" ref={setSlotRef("jira")} className="today-grid-slot" data-today-grid-slot="jira">
          {slots.jira}
        </div>
      ) : null}
      {visible.has("github") ? (
        <div key="github" ref={setSlotRef("github")} className="today-grid-slot" data-today-grid-slot="github">
          {slots.github}
        </div>
      ) : null}
      {visible.has("datadog") ? (
        <div key="datadog" ref={setSlotRef("datadog")} className="today-grid-slot" data-today-grid-slot="datadog">
          {slots.datadog}
        </div>
      ) : null}
    </ResponsiveGridLayout>
    </GridSizeContext.Provider>
  );
}

export function TodayDashboardGrid({
  ready,
  showWelcome,
  showBriefing,
  hasCalendar,
  hasJira,
  hasGithub,
  showDatadog,
  collapsedSlots,
  slots,
}: TodayDashboardGridProps) {
  const visible = useMemo(
    () => buildVisibleSet({ showWelcome, showBriefing, hasCalendar, hasJira, hasGithub, showDatadog }),
    [showWelcome, showBriefing, hasCalendar, hasJira, hasGithub, showDatadog],
  );

  const visibleKey = useMemo(() => [...visible].sort().join(","), [visible]);
  const collapsedKey = useMemo(() => [...collapsedSlots].sort().join(","), [collapsedSlots]);

  const { width, containerRef, mounted } = useContainerWidth({
    measureBeforeMount: true,
    initialWidth: 1200,
  });

  return (
    <div ref={containerRef} className="today-dashboard-grid min-w-0">
      {mounted ? (
        <TodayDashboardGridBody
          key={visibleKey}
          width={width}
          visibleKey={visibleKey}
          visible={visible}
          collapsedKey={collapsedKey}
          collapsedSlots={collapsedSlots}
          slots={slots}
          ready={ready ?? false}
        />
      ) : null}
    </div>
  );
}
