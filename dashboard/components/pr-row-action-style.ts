/** Shared styling for PR row action buttons / links, so PrRowActions and
 * PrReviewNoteLink stay visually identical (accent icon + label, two sizes). */
export type PrActionSize = "sm" | "md";

export const PR_ACTION_SIZE = {
  sm: { icon: 12, btn: "gap-1 px-1.5 py-1 text-[11px]" },
  md: { icon: 14, btn: "gap-1 px-2 py-1 text-[12px]" },
} as const satisfies Record<PrActionSize, { icon: number; btn: string }>;

export const PR_ACTION_BASE =
  "shrink-0 inline-flex items-center rounded font-medium no-underline text-[var(--accent)] transition-colors hover:bg-[var(--bg-muted)]";
