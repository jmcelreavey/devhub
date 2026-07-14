"use client";

const CONFETTI_COLORS = [
  "var(--accent)",
  "var(--success)",
  "var(--warning)",
  "var(--info)",
  "var(--violet)",
];

/**
 * One-pass confetti rain for the all-tasks-done moment. Deterministic
 * pseudo-random spread (no Math.random — repeat celebrations look alike,
 * and there's nothing to disagree with the server about). Client-only by
 * construction: only rendered from a post-mount state transition.
 */
export function ConfettiRain() {
  const pieces = Array.from({ length: 28 }, (_, i) => ({
    left: `${(i * 37 + 13) % 100}%`,
    delay: `${((i * 53) % 40) / 100}s`,
    duration: `${1 + ((i * 29) % 60) / 100}s`,
    drift: `${(((i * 17) % 90) - 45)}px`,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    round: i % 3 === 0,
  }));
  return (
    <div className="confetti-rain" aria-hidden>
      {pieces.map((p, i) => (
        <i
          key={i}
          style={{
            left: p.left,
            background: p.color,
            borderRadius: p.round ? "50%" : 2,
            ["--delay" as string]: p.delay,
            ["--dur" as string]: p.duration,
            ["--drift" as string]: p.drift,
          }}
        />
      ))}
    </div>
  );
}
