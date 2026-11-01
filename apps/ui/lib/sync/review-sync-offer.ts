export interface ReviewSyncInput {
  behind: number;
  dirtyCount: number;
  conflictCount: number;
  otherDirty: number;
  rebuildAvailable: boolean;
}

export type ReviewSyncGitAction = "conflicts" | "open-git" | "pull-and-rebuild" | "pull" | "none";

/** What the top-bar git control should do. Rebuild is only offered when a pull cannot touch uncommitted work. */
export function reviewSyncGitAction(input: ReviewSyncInput): ReviewSyncGitAction {
  if (input.conflictCount > 0) return "conflicts";
  if (input.otherDirty > 0 || (input.behind > 0 && input.dirtyCount > 0)) return "open-git";
  if (input.behind > 0 && input.rebuildAvailable) return "pull-and-rebuild";
  if (input.behind > 0) return "pull";
  return "none";
}
