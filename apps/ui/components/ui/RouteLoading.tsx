import { PageSkeleton } from "@/components/ui/PageSkeleton";

interface RouteLoadingProps {
  /** Approximate width of the page-title shimmer, px. */
  titleWidth?: number;
  rows?: number;
  rowHeight?: number;
  variant?: "block" | "list";
}

/**
 * The single place the route-level loading convention lives.
 *
 * Every `app/<route>/loading.tsx` is a one-line re-export of this, so changing
 * how the app feels during navigation is a one-file change rather than a
 * 30-file sweep. Previously each `loading.tsx` inlined its own copy of the same
 * five lines, which is why only 8 of 35 routes had one at all — the cost of
 * adding the ninth was "write the file again".
 *
 * Why skeletons and not the branded boot overlay: `BootScreen` is the *app*
 * booting — logo, animated tagline, progress bar, full viewport. Firing it on
 * every intra-app navigation reads as "the app restarted" rather than "this
 * page is loading". It stays where it belongs, on the root `app/loading.tsx`.
 *
 * Server-rendered, so it paints immediately while the route's client bundle
 * and data are still in flight.
 */
export function RouteLoading({
  titleWidth = 140,
  rows = 6,
  rowHeight = 56,
  variant = "list",
}: RouteLoadingProps = {}) {
  return (
    <PageSkeleton titleWidth={titleWidth} rows={rows} rowHeight={rowHeight} variant={variant} />
  );
}

export default RouteLoading;
