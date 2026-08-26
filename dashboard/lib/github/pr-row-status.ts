import type { GithubPrRow } from "@/lib/github/prs";

/**
 * Kept out of `prs.ts` because `PrRow` is a client component: that module
 * reaches `gh-exec` → `node:child_process`, and a value import from a client
 * component drags the whole chain into the browser bundle. `import type` above
 * is erased, so nothing server-only follows this function.
 */

/** Compact row status for icons — merged wins over approved. */
export type PrRowStatus = "merged" | "approved" | null;

export function prRowStatus(row: Pick<GithubPrRow, "approved" | "prState">): PrRowStatus {
  if (row.prState === "merged") return "merged";
  if (row.approved) return "approved";
  return null;
}
