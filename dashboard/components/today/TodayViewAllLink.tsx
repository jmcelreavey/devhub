"use client";

import Link from "next/link";
import type { MouseEvent } from "react";

/** Marks the card’s dedicated-page link so header modifier-clicks can find it. */
export const TODAY_VIEW_ALL_ATTR = "data-today-view-all";

export function TodayViewAllLink({ href }: { href: string }) {
  return (
    <Link href={href} data-today-view-all="" className="text-xs today-grid-drag-cancel text-accent">
      View all →
    </Link>
  );
}

const INTERACTIVE = "a, button, input, textarea, select, [role='tab'], [role='menuitem']";

/**
 * Shift/⌘/Ctrl-click on header chrome (not buttons, tabs, or the link itself)
 * replays onto View all so WorkspaceTabs can open the dedicated page.
 */
export function onTodayCardHeaderClick(e: MouseEvent<HTMLElement>): void {
  if (e.defaultPrevented || e.button !== 0 || e.altKey) return;
  if (!(e.shiftKey || e.metaKey || e.ctrlKey)) return;
  const target = e.target;
  if (!(target instanceof Element) || target.closest(INTERACTIVE)) return;
  const link = e.currentTarget.querySelector<HTMLAnchorElement>(`a[${TODAY_VIEW_ALL_ATTR}]`);
  if (!link) return;
  e.preventDefault();
  link.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      composed: true,
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      button: 0,
    }),
  );
}
