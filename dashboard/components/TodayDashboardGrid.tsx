"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { GridSizeContext, deriveSizeMap } from "@/lib/use-grid-size";
import {
  ResponsiveGridLayout,
  useContainerWidth,
  verticalCompactor,
  type Layout,
  type ResponsiveLayouts,
} from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { ResizeHandle } from "./ResizeHandle";
import {
  applyHeightPatchAndCompact,
  contentPxToGridHeight,
  mergeTodayGridLayouts,
  preserveHiddenTodayGridLayouts,
  readTodayGridLayoutsFromStorage,
  writeTodayGridLayoutsToStorage,
  TODAY_GRID_BREAKPOINTS,
  TODAY_GRID_COLS,
  TODAY_GRID_MARGIN,
  TODAY_GRID_ROW_HEIGHT,
  TODAY_GRID_SLOT_ORDER,
  type TodayGridBreakpoint,
  type TodayGridSlotId,
} from "@/lib/today-grid-layout";

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

function measureSlotContentPx(slot: HTMLDivElement): number {
  const target = slot.firstElementChild instanceof HTMLElement ? slot.firstElementChild : slot;
  return Math.ceil(Math.max(target.scrollHeight, target.getBoundingClientRect().height));
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
    mergeTodayGridLayouts(readTodayGridLayoutsFromStorage(), visible),
  );

  const slotRefs = useRef<Partial<Record<TodayGridSlotId, HTMLDivElement | null>>>({});
  const contentAutoLayoutDoneRef = useRef(false);
  const previousCollapsedRef = useRef<ReadonlySet<TodayGridSlotId> | null>(null);
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
      if (saved) setLayouts(mergeTodayGridLayouts(saved, visible));
    };
    window.addEventListener("devhub:grid-preset-apply", onApply);
    return () => window.removeEventListener("devhub:grid-preset-apply", onApply);
  }, [visible]);

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

    const raf = requestAnimationFrame(() => {
      const marginY = TODAY_GRID_MARGIN[1];
      const rh = TODAY_GRID_ROW_HEIGHT;
      const patch: Partial<Record<TodayGridSlotId, number>> = {};
      for (const id of TODAY_GRID_SLOT_ORDER) {
        if (!visible.has(id)) continue;
        const el = slotRefs.current[id] ?? querySlotElement(id);
        if (!el) continue;
        const px = measureSlotContentPx(el);
        patch[id] = contentPxToGridHeight(px + 8, rh, marginY);
      }
      if (Object.keys(patch).length === 0) return;
      setLayouts((prev) => {
        const next = applyHeightPatchAndCompact(prev, patch);
        if (settledRef.current) {
          writeTodayGridLayoutsToStorage(preserveHiddenTodayGridLayouts(next, readTodayGridLayoutsFromStorage()));
        }
        return next;
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [visibleKey, visible]);

  const onLayoutChange = useCallback((_layout: Layout, all: ResponsiveLayouts<TodayGridBreakpoint>) => {
    setLayouts(all);
    if (settledRef.current) {
      writeTodayGridLayoutsToStorage(preserveHiddenTodayGridLayouts(all, readTodayGridLayoutsFromStorage()));
    }
  }, []);

  useLayoutEffect(() => {
    const previous = previousCollapsedRef.current;
    previousCollapsedRef.current = new Set(collapsedSlots);

    const raf = requestAnimationFrame(() => {
      const marginY = TODAY_GRID_MARGIN[1];
      const patch: Partial<Record<TodayGridSlotId, number>> = {};
      for (const id of TODAY_GRID_SLOT_ORDER) {
        if (!visible.has(id)) continue;
        const isCollapsed = collapsedSlots.has(id);
        const changed = previous == null ? isCollapsed : previous.has(id) !== isCollapsed;
        if (!changed) continue;
        const el = slotRefs.current[id] ?? querySlotElement(id);
        if (!el) continue;
        const px = measureSlotContentPx(el);
        patch[id] = contentPxToGridHeight(px + 8, TODAY_GRID_ROW_HEIGHT, marginY);
      }
      if (Object.keys(patch).length === 0) return;
      setLayouts((prev) => {
        const next = applyHeightPatchAndCompact(prev, patch);
        if (settledRef.current) {
          writeTodayGridLayoutsToStorage(preserveHiddenTodayGridLayouts(next, readTodayGridLayoutsFromStorage()));
        }
        return next;
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [collapsedKey, collapsedSlots, visible]);

  const rowHeight = TODAY_GRID_ROW_HEIGHT;
  const margin = TODAY_GRID_MARGIN;

  const sizeMap = useMemo(() => deriveSizeMap(layouts, width), [layouts, width]);

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
