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
}

function quipForToday(quips: readonly string[]): string {
  const seed = todayISO()
    .split("")
    .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return quips[seed % quips.length];
}

export function EmptyState({ icon, title, subtitle, action, quips }: EmptyStateProps) {
  const sub = subtitle ?? (quips && quips.length > 0 ? quipForToday(quips) : undefined);
  return (
    <div className="card card-body flex flex-col items-center justify-center py-8">
      <span className="empty-pop" style={{ color: "var(--text-subtle)", marginBottom: "12px" }} aria-hidden>
        {icon}
      </span>
      <p className="text-sm mb-1" style={{ color: "var(--text-muted)" }}>{title}</p>
      {sub && (
        <p className="text-xs" style={{ color: "var(--text-subtle)" }}>{sub}</p>
      )}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
