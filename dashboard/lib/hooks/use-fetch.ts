"use client";

import useSWR, { type SWRConfiguration } from "swr";
import { usePanelVisible } from "@/lib/hooks/panel-visibility";

export const defaultFetcher = async (url: string): Promise<unknown> => {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text;
    try {
      const payload = JSON.parse(text) as { error?: unknown };
      if (typeof payload.error === "string") message = payload.error;
    } catch {
      // Plain-text responses are already suitable for display.
    }
    throw new Error(message || `Request failed (${res.status})`);
  }
  return res.json();
};

const liveDefaults: SWRConfiguration = {
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  refreshInterval: 60_000,
  dedupingInterval: 5_000,
};

export function useLive<T = unknown>(key: string | null, opts?: SWRConfiguration) {
  // Keep-alive tabs never unmount, so without this every tab ever opened keeps
  // polling forever. Paused hooks still serve cached data and revalidate on the
  // way back in. An explicit `isPaused` from the caller still wins.
  const visible = usePanelVisible();
  return useSWR<T>(key, defaultFetcher as (k: string) => Promise<T>, {
    ...liveDefaults,
    isPaused: () => !visible,
    ...opts,
  });
}
