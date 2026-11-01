"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface VirtualWindow {
  /** First row index to render. */
  start: number;
  /** Exclusive end index. */
  end: number;
  /** Spacer height above the rendered slice, px. */
  padTop: number;
  /** Spacer height below the rendered slice, px. */
  padBottom: number;
}

/**
 * Fixed-height row windowing for long, uniform lists.
 *
 * Deliberately not a virtualization library: these lists are flat arrays of
 * equal-height rows, which is the one case windowing is four lines of maths.
 * Pulling in react-window would add a dependency to solve a smaller problem
 * than the one it's built for.
 *
 * Rows outside the viewport are not rendered at all, so a 30k-line transcript
 * costs the same as a 30-line one. `overscan` keeps a buffer either side so
 * fast scrolling doesn't flash empty space.
 */
export function useVirtualRows(
  rowCount: number,
  rowHeight: number,
  overscan = 12,
): {
  scrollRef: (node: HTMLElement | null) => void;
  window: VirtualWindow;
  /** Centre a row by index. Works for rows that aren't currently mounted. */
  scrollToRow: (index: number) => void;
} {
  const nodeRef = useRef<HTMLElement | null>(null);
  const [range, setRange] = useState({ scrollTop: 0, viewport: 0 });

  const measure = useCallback(() => {
    const node = nodeRef.current;
    if (!node) return;
    setRange((prev) =>
      prev.scrollTop === node.scrollTop && prev.viewport === node.clientHeight
        ? prev
        : { scrollTop: node.scrollTop, viewport: node.clientHeight },
    );
  }, []);

  // Callback ref rather than useEffect+ref.current: the scroll container is
  // conditionally rendered (skeleton → content), so we need to attach listeners
  // at the moment the node appears, not on a render that may precede it.
  const scrollRef = useCallback(
    (node: HTMLElement | null) => {
      nodeRef.current = node;
      if (node) measure();
    },
    [measure],
  );

  /**
   * Scrolling to an *index* rather than a DOM node matters here: the target row
   * is usually outside the window and therefore not mounted, so the usual
   * `ref.scrollIntoView()` would silently do nothing.
   */
  const scrollToRow = useCallback(
    (index: number) => {
      const node = nodeRef.current;
      if (!node || index < 0) return;
      node.scrollTop = Math.max(0, index * rowHeight - node.clientHeight / 2);
      measure();
    },
    [measure, rowHeight],
  );

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    node.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      node.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [measure, rowCount]);

  const viewport = range.viewport || 0;
  // Before the first measurement render a screenful so the list is never blank
  // (and so non-interactive contexts like tests still see content).
  const visible = viewport > 0 ? Math.ceil(viewport / rowHeight) : Math.min(rowCount, 40);
  const start = Math.max(0, Math.floor(range.scrollTop / rowHeight) - overscan);
  const end = Math.min(rowCount, start + visible + overscan * 2);

  return {
    scrollRef,
    scrollToRow,
    window: {
      start,
      end,
      padTop: start * rowHeight,
      padBottom: Math.max(0, (rowCount - end) * rowHeight),
    },
  };
}
