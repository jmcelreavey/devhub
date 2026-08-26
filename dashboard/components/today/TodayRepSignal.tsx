"use client";

import Link from "next/link";
import { Dumbbell } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import { repTeaser, type RepsApiPayload } from "@/lib/reps-shared";

/**
 * Hero chip for the daily rep — the Today-page hook for a habit that lives on
 * /review/rep. Shares the SWR key with DailyRepCard, so having both mounted
 * costs one request.
 */
export function TodayRepSignal() {
  const { data, error } = useLive<RepsApiPayload>("/api/reps");

  if (error || !data) return null;
  const rep = data.rep;
  const streak = data.stats?.streak ?? 0;

  const done = !!rep?.completedAt;
  const text = !rep ? "Start today's rep" : done ? "Rep done" : repTeaser(rep);
  const live = !done;

  return (
    <Link
      href="/review/rep"
      className="hero-signal"
      aria-label={`Daily rep: ${text}${streak > 0 ? `, ${streak} day streak` : ""}`}
    >
      <Dumbbell size={11} aria-hidden className={live ? "text-accent" : "text-success"} />
      <span className="hero-signal-kind">Rep</span>
      <span className="hero-signal-text">{text}</span>
      {streak > 0 && <span className="hero-signal-meta">{streak}d</span>}
    </Link>
  );
}
