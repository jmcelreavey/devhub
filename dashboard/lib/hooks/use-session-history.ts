"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  getServerSessionHistory,
  getSessionHistory,
  publishSessionLabel,
  subscribeSessionHistory,
} from "@/lib/session-history";

export function useSessionHistory() {
  return useSyncExternalStore(subscribeSessionHistory, getSessionHistory, getServerSessionHistory);
}

export function useRouteHistoryLabel(label: string | null | undefined): void {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const href = query ? `${pathname}?${query}` : pathname;

  useEffect(() => {
    if (label?.trim()) publishSessionLabel(href, label.trim());
  }, [href, label]);
}
