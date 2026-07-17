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
          ? "flex flex-col items-start justify-center py-6 text-left"
          : "card card-body flex flex-col items-start justify-center py-6 text-left"
      }
    >
      <div className="flex items-start gap-2.5">
        {icon ? (
          <span className="empty-pop shrink-0 mt-0.5" style={{ color: "var(--text-subtle)" }} aria-hidden>
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <p className="text-sm mb-1" style={{ color: "var(--text-muted)" }}>{title}</p>
          {sub && (
            <p className="text-xs" style={{ color: "var(--text-subtle)" }}>{sub}</p>
          )}
        </div>
      </div>
      {action ? <div className="mt-3 ml-0">{action}</div> : null}
    </div>
  );
}
