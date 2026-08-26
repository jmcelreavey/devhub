"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { buildCrumbs } from "@/lib/nav";
import { recordRouteVisit } from "@/lib/route-usage";
import { recordSessionVisit } from "@/lib/session-history";
import { todayISO } from "@/lib/utils";

/**
 * Tallies which routes actually get opened, so the twelve `LEGACY_NAV_ITEMS`
 * that only exist behind ⌘K can be judged on evidence rather than on whether
 * anyone remembers using them. Read it back with the "Show route usage"
 * command in the palette.
 *
 * The ordered session trail is separate from the persisted usage tally: one
 * answers "where was I?", the other answers "do I use this?".
 */
export function RouteUsageRecorder() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  useEffect(() => {
    if (!pathname) return;
    recordRouteVisit(pathname, todayISO());
    const href = query ? `${pathname}?${query}` : pathname;
    const label = buildCrumbs(pathname).at(-1)?.label ?? pathname;
    recordSessionVisit({ href, label, ts: Date.now() });
  }, [pathname, query]);

  return null;
}
