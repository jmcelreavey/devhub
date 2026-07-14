"use client";

import Link from "next/link";
import { FlaskConical, X } from "lucide-react";
import { useLive } from "@/lib/use-fetch";
import { useCallback, useMemo, useState } from "react";

interface DriftEntry {
  id: string;
  label: string;
  area: string;
  daysSinceMine: number | null;
  repoDelta: number;
  repoCount: number;
}

interface RadarPayload {
  diff?: { drift?: DriftEntry[] };
}

const DISMISS_KEY = "devhub.capability-drift.dismissed";

function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

/** Capability drift → Today nudges with lab links. */
export function CapabilityDriftNudges() {
  const { data } = useLive<RadarPayload>("/api/capability/radar", { refreshInterval: 0 });
  const [dismissed, setDismissed] = useState<Set<string>>(() =>
    typeof window === "undefined" ? new Set() : readDismissed(),
  );

  const drift = useMemo(() => {
    const all = data?.diff?.drift ?? [];
    return all.filter((d) => !dismissed.has(d.id)).slice(0, 4);
  }, [data, dismissed]);

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem(DISMISS_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  if (drift.length === 0) return null;

  return (
    <section
      className="mb-3 rounded-lg border border-border bg-bg-elevated px-3 py-2.5"
      aria-label="Capability drift nudges"
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-text">
        <FlaskConical size={13} aria-hidden />
        Capability drift
      </div>
      <ul className="space-y-1.5">
        {drift.map((d) => (
          <li key={d.id} className="flex items-start justify-between gap-2 text-xs text-text-subtle">
            <div className="min-w-0">
              <span className="text-text">{d.label}</span>
              <span className="ml-1.5 text-text-muted">
                {d.daysSinceMine != null ? `${d.daysSinceMine}d since you touched it` : "growing untouched"}
                {d.repoDelta > 0 ? ` · +${d.repoDelta} repos` : ""}
              </span>
              <div className="mt-0.5">
                <Link href={`/radar?signal=${encodeURIComponent(d.id)}`} className="text-accent underline-offset-2 hover:underline">
                  Open on Radar
                </Link>
                {" · "}
                <Link href={`/radar?lab=${encodeURIComponent(d.id)}`} className="text-accent underline-offset-2 hover:underline">
                  Propose lab
                </Link>
              </div>
            </div>
            <button
              type="button"
              className="hub-icon-btn shrink-0"
              aria-label={`Dismiss ${d.label}`}
              onClick={() => dismiss(d.id)}
            >
              <X size={12} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
