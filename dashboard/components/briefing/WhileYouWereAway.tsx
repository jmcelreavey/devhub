"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import { formatRelativePastAge } from "@/lib/utils";
import { useMinuteTick } from "@/lib/minute-tick";
import type { AwayDigest } from "@/lib/since-last-visit";

const LAST_VISIT_KEY = "devhub:last-visit";

/**
 * "What changed while I was away" (F-A).
 *
 * Shows only when a background run **failed** while you weren't looking.
 * Successes are counted but don't earn a banner — the same lesson repo health
 * taught: a notification that appears every morning regardless of content is
 * one you stop reading, and then it fails to work on the morning it matters.
 *
 * The timestamp lives in localStorage because it's per-browser, and it's
 * written on unmount rather than on mount so that opening the page doesn't
 * immediately mark everything as seen before you've read it.
 */
export function WhileYouWereAway() {
  const [dismissed, setDismissed] = useState(false);
  const now = useMinuteTick();

  /*
    Lazy initialiser rather than a setState in an effect. This component is
    only ever rendered past TodayViewSwitch's mount gate, so localStorage is
    available on the first render and reading it here avoids the cascading
    render the effect version caused.
  */
  const [since] = useState<number>(() => {
    try {
      const parsed = Number(window.localStorage.getItem(LAST_VISIT_KEY));
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    } catch {
      /* private browsing */
    }
    return Date.now() - 12 * 60 * 60 * 1000;
  });

  useEffect(() => {
    // Stamp on the way out, not the way in — otherwise opening the page marks
    // everything as seen before you've had a chance to read it.
    return () => {
      try {
        window.localStorage.setItem(LAST_VISIT_KEY, String(Date.now()));
      } catch {
        /* private browsing / quota - the banner just re-shows */
      }
    };
  }, []);

  const { data } = useLive<AwayDigest>(`/api/since?ts=${since}`, {
    refreshInterval: 0,
  });

  if (dismissed || !data || data.failedRuns.length === 0) return null;

  const failures = data.failedRuns;

  return (
    <div
      role="status"
      className="mb-3 flex items-start gap-2.5 rounded-lg px-3 py-2.5"
      style={{
        border: "1px solid var(--danger)",
        background: "var(--danger-dim)",
        color: "var(--text)",
      }}
    >
      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-medium">
          {failures.length === 1
            ? "A background job failed while you were away"
            : `${failures.length} background jobs failed while you were away`}
        </div>
        <ul className="mt-1 flex flex-col gap-0.5" style={{ color: "var(--text-muted)" }}>
          {failures.slice(0, 4).map((f) => (
            <li key={f.runId} className="truncate text-xs">
              <span className="font-mono">{f.script}</span>
              {f.exitCode !== undefined ? ` · exit ${f.exitCode}` : ""}
              {` · ${formatRelativePastAge(Math.max(0, now - f.startedAt))}`}
            </li>
          ))}
          {failures.length > 4 && (
            <li className="text-xs">+{failures.length - 4} more — see Run history on System</li>
          )}
        </ul>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="shrink-0 rounded p-1 hover:bg-[var(--bg-elevated)]"
        style={{ color: "var(--text-subtle)" }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
