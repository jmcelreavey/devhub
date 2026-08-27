/** `origin/main` → `main`. Same rule as the history log route. */
export function shortDefaultBranchName(mainBranch: string | null | undefined): string | null {
  if (!mainBranch) return null;
  return mainBranch.replace(/^origin\//, "");
}

export function isOnDefaultBranch(
  currentBranch: string,
  mainBranch: string | null | undefined,
): boolean {
  const short = shortDefaultBranchName(mainBranch ?? null);
  return Boolean(short) && (currentBranch === short || currentBranch === mainBranch);
}

/**
 * Tip is reachable from the default branch — fully merged (or identical).
 * Mirrors `mergedIntoMain` on GET /git/log: not on main, zero commits ahead.
 */
export function isMergedIntoDefaultBranch(opts: {
  currentBranch: string;
  mainBranch: string | null | undefined;
  aheadMain: number;
}): boolean {
  return (
    Boolean(opts.mainBranch) &&
    !isOnDefaultBranch(opts.currentBranch, opts.mainBranch) &&
    opts.aheadMain === 0
  );
}

/** Show "switch to default & fetch" only on a merged topic branch. */
export function shouldOfferSwitchToDefault(opts: {
  onMain: boolean;
  mergedIntoMain: boolean;
}): boolean {
  return opts.mergedIntoMain && !opts.onMain;
}
