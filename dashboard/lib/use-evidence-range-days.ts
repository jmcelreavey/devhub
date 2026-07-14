"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  EVIDENCE_RANGE_STORAGE_KEY,
  parseEvidenceDays,
  type EvidenceRangeDays,
} from "@/lib/appraisal-evidence-range";

const CHANGE_EVENT = "devhub:appraisal-evidence-days-change";

function readDays(): EvidenceRangeDays {
  if (typeof window === "undefined") return 7;
  return parseEvidenceDays(localStorage.getItem(EVIDENCE_RANGE_STORAGE_KEY), 7);
}

function subscribe(cb: () => void) {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** Persisted evidence lookback (7/14/30/90). Shared by /appraisal and /one-on-one. */
export function useEvidenceRangeDays(): [EvidenceRangeDays, (days: EvidenceRangeDays) => void] {
  const days = useSyncExternalStore(subscribe, readDays, () => 7 as EvidenceRangeDays);
  const setDays = useCallback((next: EvidenceRangeDays) => {
    localStorage.setItem(EVIDENCE_RANGE_STORAGE_KEY, String(next));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [days, setDays];
}
