interface SkeletonRowsProps {
  count?: number;
  height?: number;
  /**
   * Shape of each shimmering row (loaders should match the silhouette of
   * the content they become — the settle feels seamless):
   * - "block": one solid bar (default; cards, panels)
   * - "list":  icon dot + title bar + trailing meta chip (PR/ticket/event rows)
   */
  variant?: "block" | "list";
}

export function SkeletonRows({ count = 3, height = 60, variant = "block" }: SkeletonRowsProps) {
  if (variant === "list") {
    return (
      <div className="stagger-children space-y-2" aria-hidden>
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-3"
            style={{ height: Math.max(height, 24), padding: "0 2px" }}
          >
            <span className="skeleton shrink-0" style={{ width: 16, height: 16, borderRadius: "50%" }} />
            <span
              className="skeleton min-w-0 flex-1"
              style={{ height: 12, borderRadius: 6, maxWidth: `${72 - (i % 3) * 14}%` }}
            />
            <span className="skeleton shrink-0" style={{ width: 56, height: 12, borderRadius: 999 }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="stagger-children space-y-2" aria-hidden>
      {/* Shimmer bar nests inside a plain wrapper so the stagger entrance
          (on the wrapper) and the shimmer loop (on .skeleton) don't fight
          over the same `animation` property. */}
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <div className="skeleton" style={{ height, borderRadius: "var(--radius)" }} />
        </div>
      ))}
    </div>
  );
}
