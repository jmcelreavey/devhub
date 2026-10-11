/** The Shift Dock's three rails and lime hub, separated so the loader can dock. */
export function ShiftDockMark({ className = "" }: { className?: string }) {
  return (
    <svg className={`graphite-dock-mark ${className}`} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect className="graphite-dock-socket" x="34" y="18" width="28" height="28" rx="8" />
      <g className="graphite-dock-rails">
        <rect x="5" y="5" width="40" height="12" rx="6" />
        <rect x="5" y="47" width="40" height="12" rx="6" />
      </g>
      <rect className="graphite-dock-feed" x="5" y="26" width="28" height="12" rx="6" />
      <rect className="graphite-dock-hub" x="37" y="21" width="22" height="22" rx="5" />
    </svg>
  );
}
