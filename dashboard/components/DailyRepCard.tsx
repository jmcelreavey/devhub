"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Dumbbell, Flame } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import { RepStreakStrip } from "@/components/reps/RepStreakStrip";
import type { GithubPrsApiPayload } from "@/lib/github/prs";
import type { RepsApiPayload } from "@/lib/reps";

export function DailyRepCard() {
  const router = useRouter();
  const { data: prData } = useLive<GithubPrsApiPayload>("/api/github/prs");
  const { data, error, mutate } = useLive<RepsApiPayload>("/api/reps");
  const [starting, setStarting] = useState(false);

  const rep = data?.rep ?? null;
  const stats = data?.stats;
  const topReview = prData?.reviews?.[0];

  async function start() {
    if (!topReview) return;
    setStarting(true);
    try {
      const res = await fetch("/api/reps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          pr: { repo: topReview.repo, number: topReview.number, title: topReview.title, url: topReview.url },
        }),
      });
      if (res.ok) router.push("/review/rep");
    } finally {
      setStarting(false);
    }
  }

  let stateLine = "Loading…";
  let action: React.ReactNode = null;
  if (error) {
    stateLine = "Couldn't load today's rep.";
  } else if (data && !rep) {
    if (!prData) {
      stateLine = "Loading review queue…";
    } else if (!prData.configured) {
      stateLine = "GitHub not configured.";
    } else if (!topReview) {
      stateLine = `No PRs awaiting review — rest day.`;
    } else {
      stateLine = `${prData.reviews.length} PR${prData.reviews.length === 1 ? "" : "s"} awaiting review. Today's rep: review one AI-free first.`;
      action = (
        <button type="button" className="btn btn-primary" disabled={starting} onClick={() => void start()}>
          <Dumbbell size={12} aria-hidden /> Start today&apos;s rep
        </button>
      );
    }
  } else if (rep?.pr) {
    const pr = rep.pr;
    if (!rep.completedAt) {
      stateLine = `In progress: ${pr.title}`;
      action = (
        <Link href="/review/rep" className="btn btn-primary">
          Continue rep
        </Link>
      );
    } else if (!rep.grade) {
      stateLine = `Findings saved for ${pr.title}. Compare with the agent and grade it.`;
      action = (
        <Link href="/review/rep" className="btn btn-primary">
          Compare & grade
        </Link>
      );
    } else {
      stateLine = `Done today — caught ${rep.grade.caught}, missed ${rep.grade.missed}.`;
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
