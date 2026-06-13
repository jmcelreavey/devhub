import { SkeletonRows } from "./SkeletonRows";

interface PageSkeletonProps {
  /** Approximate width of the page title shimmer, px. */
  titleWidth?: number;
  rows?: number;
  rowHeight?: number;
  variant?: "block" | "list";
}

/**
 * Route-level loading state (`app/<route>/loading.tsx`). Renders the
 * standard page chrome with shimmering placeholders so navigation never
 * shows a blank main area. Server-rendered — appears instantly while the
 * page's client bundle and data load.
 */
export function PageSkeleton({ titleWidth = 140, rows = 4, rowHeight = 56, variant = "block" }: PageSkeletonProps) {
  return (
    <div className="page-wrapper" aria-busy="true" aria-label="Loading page">
      <div className="page-header">
        <span className="skeleton" style={{ width: titleWidth, height: 22, borderRadius: 6 }} />
      </div>
      <SkeletonRows count={rows} height={rowHeight} variant={variant} />
    </div>
  );
}
