"use client";

import Link from "next/link";
import { Dumbbell } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import type { GithubPrsApiPayload } from "@/lib/github/prs";
import type { RepsApiPayload } from "@/lib/reps";

/**
 * Hero chip for the daily review rep — the Today-page hook for a habit that
 * lives on /review. Shares SWR keys with DailyRepCard, so having both mounted
 * costs one request.
 *
 * Hidden entirely when there is nothing to act on and nothing in progress:
 * a rest day should read as silence, not as a fourth permanent chip.
 */
export function TodayRepSignal() {
  const { data: prData } = useLive<GithubPrsApiPayload>("/api/github/prs");
  const { data, error } = useLive<RepsApiPayload>("/api/reps");

  if (error) return null;
  const rep = data?.rep ?? null;
  const stats = data?.stats;
  const streak = stats?.streak ?? 0;

  let text: string | null = null;
  let live = false;
  if (rep?.pr) {
    if (!rep.completedAt) {
      text = rep.pr.title;
      live = true;
    } else if (!rep.grade) {
      text = "Compare & grade today's rep";
      live = true;
    } else {
      text = "Rep done";
    }
  } else if (data && prData?.configured) {
    const top = prData.reviews?.[0];
    if (top) {
      const repo = top.repo.split("/")[1] ?? top.repo;
      text = `Review ${repo}#${top.number}`;
      live = true;
    }
  }
  if (!text) return null;

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
