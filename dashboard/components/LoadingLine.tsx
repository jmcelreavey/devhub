import { SkeletonRows } from "./SkeletonRows";

/**
 * Canonical inline loading state. Renders shimmering list rows (matching
 * the silhouette of the content they become) instead of bare "Loading…"
 * text, so every async section in the app loads the same way. The message
 * survives for screen readers.
 */
export function LoadingLine({
  message = "Loading…",
  rows = 3,
}: {
  message?: string;
  rows?: number;
}) {
  return (
    <div role="status" aria-label={message} className="py-2">
      <SkeletonRows count={rows} height={28} variant="list" />
      <span className="sr-only">{message}</span>
    </div>
  );
}
