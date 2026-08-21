"use client";

import { useLive } from "@/lib/hooks/use-fetch";
import type { RepsApiPayload } from "@/lib/reps";

/** Today's rep state. Shared SWR key — every consumer dedupes into one request. */
export function useTodayRep() {
  return useLive<RepsApiPayload>("/api/reps");
}
