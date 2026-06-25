"use client";

import { MobileTopBar } from "./MobileTopBar";
import { MobileBottomShelf } from "./MobileBottomShelf";

/**
 * Single owner of the mobile-only chrome (`md:hidden` throughout). Previously
 * the top bar and bottom shelf were mounted separately in the root layout and
 * the nav drawer lived a third place again — this groups them so there's one
 * place to reason about phone navigation.
 *
 * Layout notes:
 * - `MobileTopBar` renders in normal flow at the top of the content column
 *   (it carries the burger → `MobileNav` drawer, brand, search, and the
 *   quick-actions overflow).
 * - `MobileBottomShelf` is `position: fixed`, so its DOM position here doesn't
 *   affect where it paints — it stays pinned to the viewport bottom and is not
 *   clipped by the column's `overflow-hidden` (fixed elements are contained by
 *   the viewport, not an overflow ancestor).
 */
export function MobileShell() {
  return (
    <>
      <MobileTopBar />
      <MobileBottomShelf />
    </>
  );
}
