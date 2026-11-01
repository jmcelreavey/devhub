"use client";

import { useLive } from "@/lib/hooks/use-fetch";

export function useQa<T extends { runs: Array<{ state: string }> }>(enabled = true) {
  return useLive<T>(enabled ? "/api/qa?scope=local" : null);
}
