"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useLive } from "@/lib/hooks/use-fetch";
import type { SetupGateStatus } from "@/lib/nav";

const CACHE_KEY = "devhub:setup-status";

let cachedRaw: string | null = null;
let cachedValue: SetupGateStatus | undefined;

/** Parsed once per distinct raw string so useSyncExternalStore sees a stable snapshot. */
function readCache(): SetupGateStatus | undefined {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(CACHE_KEY);
  } catch {
    return undefined;
  }
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : undefined;
    cachedValue = parsed && typeof parsed === "object" ? (parsed as SetupGateStatus) : undefined;
  } catch {
    cachedValue = undefined;
  }
  return cachedValue;
}

const noSubscribe = () => () => {};

/**
 * `/api/setup/status` for nav chrome, seeded from the last answer.
 *
 * The route takes seconds on a cold start, and until it answers every gated
 * sidebar row is hidden — Calendar, PRs and the BI group popped in late on
 * every load. The last-known status is almost always still right; the live
 * fetch corrects it when it isn't.
 */
export function useSetupStatus(): SetupGateStatus | undefined {
  const cached = useSyncExternalStore(noSubscribe, readCache, () => undefined);
  const { data } = useLive<SetupGateStatus>("/api/setup/status", { refreshInterval: 0 });

  useEffect(() => {
    if (!data) return;
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch {
      // Storage full or disabled: the live value still renders, we just lose the head start.
    }
  }, [data]);

  return data ?? cached;
}
