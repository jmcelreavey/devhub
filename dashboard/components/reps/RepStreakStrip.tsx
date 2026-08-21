"use client";

import type { RepDayPoint } from "@/lib/reps";

const DAY_LABEL = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/** Last-N-days completion dots. Filled = rep done; red tint when more missed than caught. */
export function RepStreakStrip({ days }: { days: RepDayPoint[] }) {
  return (
    <div className="flex flex-wrap gap-1" role="img" aria-label="Daily rep history, last 5 weeks">
      {days.map((d) => {
        const struggled = d.done && d.caught !== undefined && d.caught < (d.missed ?? 0);
        return (
          <span
            key={d.date}
            title={
              d.done
                ? `${DAY_LABEL(d.date)} — done${d.caught !== undefined ? ` · caught ${d.caught}, missed ${d.missed ?? 0}` : ""}`
                : `${DAY_LABEL(d.date)} — no rep`
            }
            className="inline-block rounded-sm"
            style={{
              width: 10,
              height: 10,
              background: d.done ? (struggled ? "var(--danger-dim)" : "var(--accent-dim)") : "var(--bg-elevated)",
              border: `1px solid ${d.done ? (struggled ? "var(--danger)" : "var(--accent)") : "var(--border)"}`,
            }}
          />
        );
      })}
    </div>
  );
}
