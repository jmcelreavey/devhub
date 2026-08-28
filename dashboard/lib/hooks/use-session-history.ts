"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  getServerSessionHistory,
  getSessionHistory,
  subscribeSessionHistory,
} from "@/lib/session-history";
import { useWorkspaceTabs } from "@/components/shell/WorkspaceTabs";

export function useSessionHistory() {
  return useSyncExternalStore(subscribeSessionHistory, getSessionHistory, getServerSessionHistory);
}

export function useRouteHistoryLabel(label: string | null | undefined): void {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const href = query ? `${pathname}?${query}` : pathname;
  const { publishLabel } = useWorkspaceTabs();

  useEffect(() => {
    if (label?.trim()) publishLabel(href, label.trim());
  }, [href, label, publishLabel]);
}
