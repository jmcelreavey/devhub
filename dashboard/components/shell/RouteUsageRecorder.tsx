"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { recordRouteVisit } from "@/lib/route-usage";
import { todayISO } from "@/lib/utils";

/**
 * Tallies which routes actually get opened, so the twelve `LEGACY_NAV_ITEMS`
 * that only exist behind ⌘K can be judged on evidence rather than on whether
 * anyone remembers using them. Read it back with the "Show route usage"
 * command in the palette.
 *
 * Renders nothing, writes only to localStorage, sends nothing anywhere.
 */
export function RouteUsageRecorder() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    recordRouteVisit(pathname, todayISO());
  }, [pathname]);

  return null;
}
