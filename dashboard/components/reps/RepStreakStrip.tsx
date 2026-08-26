"use client";

import type { RepDayPoint } from "@/lib/reps-shared";

const DAY_LABEL = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/** Last-N-days completion dots. Filled = rep done. */
export function RepStreakStrip({ days }: { days: RepDayPoint[] }) {
  return (
    <div className="flex flex-wrap gap-1" role="img" aria-label="Daily rep history, last 5 weeks">
      {days.map((d) => (
        <span
          key={d.date}
          title={`${DAY_LABEL(d.date)} — ${d.done ? "done" : "no rep"}`}
          className="inline-block rounded-sm"
          style={{
            width: 10,
            height: 10,
            background: d.done ? "var(--accent-dim)" : "var(--bg-elevated)",
            border: `1px solid ${d.done ? "var(--accent)" : "var(--border)"}`,
          }}
        />
      ))}
    </div>
  );
}
