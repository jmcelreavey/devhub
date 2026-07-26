"use client";

import useSWR, { type SWRConfiguration } from "swr";

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
  return useSWR<T>(key, defaultFetcher as (k: string) => Promise<T>, {
    ...liveDefaults,
    ...opts,
  });
}
