"use client";

import { ReactNode } from "react";
import { todayISO } from "@/lib/utils";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  /**
   * Optional personality lines — one is picked per day (date-seeded, so it
   * doesn't change on re-render) and shown when no `subtitle` is given.
   * Keep them dry; the charm is restraint.
   */
  quips?: readonly string[];
  /** Flat panel — use when already inside a `.card` (avoids card-in-card). */
  bare?: boolean;
}

const HOLLOW_WHISPERS = [
  "…it's quiet here. too quiet.",
  "nothing left. or nothing yet?",
  "don't look behind you",
  "something was here.",
] as const;

function hollowWhisper(title: string): string {
  let seed = 0;
  for (const ch of title) seed += ch.charCodeAt(0);
  return HOLLOW_WHISPERS[seed % HOLLOW_WHISPERS.length];
}

function quipForToday(quips: readonly string[]): string {
  const seed = todayISO()
    .split("")
    .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return quips[seed % quips.length];
}

export function EmptyState({ icon, title, subtitle, action, quips, bare }: EmptyStateProps) {
  const sub = subtitle ?? (quips && quips.length > 0 ? quipForToday(quips) : undefined);
  return (
    <div
      className={
        bare
          ? "empty-state flex flex-col items-start justify-center py-6 text-left"
          : "empty-state card card-body flex flex-col items-start justify-center py-6 text-left"
      }
    >
      <div className="flex items-start gap-2.5">
        {icon ? (
          <span className="empty-pop shrink-0 mt-0.5 text-text-subtle" aria-hidden>
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <p className="text-sm mb-1 text-text-muted">{title}</p>
          {sub && (
            <p className="text-xs text-text-subtle">{sub}</p>
          )}
          <p className="hollow-whisper">{hollowWhisper(title)}</p>
        </div>
      </div>
      {action ? <div className="mt-3 ml-0">{action}</div> : null}
    </div>
  );
}
