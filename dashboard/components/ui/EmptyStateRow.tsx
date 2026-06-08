import type { ReactNode } from "react";

interface EmptyStateRowProps {
  /** When true, show a thin labelled placeholder instead of nothing */
  gripper?: boolean;
  label?: string;
  children?: never;
}

/**
 * Drop-in replacement for subsections that render a "None" placeholder when empty.
 * Usage: wrap the subsection list and pass `gripper` if you want a visible empty slot,
 * or render nothing (default) so dead space is reclaimed.
 */
export function EmptyStateRow({ gripper, label }: EmptyStateRowProps) {
  if (!gripper) return null;
  return (
    <div
      style={{
        height: 24,
        display: "flex",
        alignItems: "center",
        paddingLeft: 8,
        borderRadius: 4,
        border: "1px dashed var(--border-muted)",
        color: "var(--text-subtle)",
        fontSize: 11,
      }}
    >
      {label ?? "Empty"}
    </div>
  );
}

interface ConditionalListProps<T> {
  items: T[];
  renderList: (items: T[]) => ReactNode;
  emptyGripper?: boolean;
  emptyLabel?: string;
}

/** Renders the list when non-empty, EmptyStateRow when empty. */
export function ConditionalList<T>({ items, renderList, emptyGripper, emptyLabel }: ConditionalListProps<T>) {
  if (items.length === 0) return <EmptyStateRow gripper={emptyGripper} label={emptyLabel} />;
  return <>{renderList(items)}</>;
}
