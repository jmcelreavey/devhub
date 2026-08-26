"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Dumbbell, Flame } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import { RepStreakStrip } from "@/components/reps/RepStreakStrip";
import { REP_KIND_LABEL, repTeaser, type RepsApiPayload } from "@/lib/reps-shared";

export function DailyRepCard() {
  const router = useRouter();
  const { data, error, mutate } = useLive<RepsApiPayload>("/api/reps");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const rep = data?.rep ?? null;
  const stats = data?.stats;

  async function start() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch("/api/reps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      if (res.ok) {
        router.push("/review/rep");
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setStartError(body.error ?? "Couldn't start today's rep.");
      }
    } finally {
      setStarting(false);
    }
  }

  let stateLine = "Loading…";
  let action: React.ReactNode = null;
  if (error) {
    stateLine = "Couldn't load today's rep.";
  } else if (data && !rep) {
    stateLine =
      startError ??
      "Cold reads, gap sketches, and recall — real material from your repos, one a day.";
    action = (
      <button type="button" className="btn btn-primary" disabled={starting} onClick={() => void start()}>
        <Dumbbell size={12} aria-hidden /> Start today&apos;s rep
      </button>
    );
  } else if (rep) {
    if (!rep.completedAt) {
      stateLine = `In progress — ${repTeaser(rep)}`;
      action = (
        <Link href="/review/rep" className="btn btn-primary">
          Continue rep
        </Link>
      );
    } else {
      stateLine = `Done today — ${REP_KIND_LABEL[rep.kind].toLowerCase()} complete.`;
      action = (
        <span className="text-xs text-text-subtle inline-flex items-center gap-1">
          <Check size={12} aria-hidden /> Rep complete
        </span>
      );
    }
  }

  return (
    <div className="card card-body mb-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-xs font-medium mb-1.5 text-text-muted inline-flex items-center gap-1.5">
            <Dumbbell size={12} aria-hidden /> Daily rep
            {stats && stats.streak > 0 && (
              <span
                className="badge inline-flex items-center gap-1"
                style={{ background: "var(--accent-dim)", color: "var(--accent)" }}
              >
                <Flame size={10} aria-hidden /> {stats.streak}d
              </span>
            )}
          </div>
          <p className="text-sm text-text-subtle m-0 break-words">{stateLine}</p>
          {stats && stats.recent.some((d) => d.done) && (
            <div className="mt-2">
              <RepStreakStrip days={stats.recent} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {action}
          {rep && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: "4px 10px" }}
              onClick={() => void mutate()}
              aria-label="Refresh rep status"
            >
              Refresh
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
