"use client";

import useSWR, { type SWRConfiguration } from "swr";
import { usePanelVisible } from "@/lib/hooks/panel-visibility";

export const defaultFetcher = async (url: string): Promise<unknown> => {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
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
