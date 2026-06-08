import type { ReactNode } from "react";
import { SkeletonRows } from "@/components/SkeletonRows";

export interface AsyncListSectionProps {
  loading: boolean;
  isEmpty: boolean;
  empty: ReactNode;
  skeletonCount?: number;
  skeletonHeight?: number;
  loadingFallback?: ReactNode;
  children: ReactNode;
}

/**
 * Standard list loading UX: skeleton while loading, empty state when done with no rows, else children.
 * Avoids showing stale list data alongside a skeleton.
 */
export function AsyncListSection({
  loading,
  isEmpty,
  empty,
  skeletonCount = 3,
  skeletonHeight = 60,
  loadingFallback,
  children,
}: AsyncListSectionProps) {
  if (loading) return loadingFallback ?? <SkeletonRows count={skeletonCount} height={skeletonHeight} />;
  if (isEmpty) return <>{empty}</>;
  return <>{children}</>;
}
