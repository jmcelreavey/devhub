import type { RepoGitOverviewRepo } from "@shared/repos/types";

/** A repo the user still has to do something about: conflicts > changes > behind > unpushed.
 *  A repo whose status failed stays in the list — "unknown" is not "clean". */
export function needsAttention(repo: RepoGitOverviewRepo): boolean {
  return repo.error === true || repo.conflictCount > 0 || repo.dirtyCount > 0 || repo.behind > 0 || repo.ahead > 0;
}

/** Compact relative age for the rail's last-activity column. */
export function relativeAge(ms: number): string {
  if (!ms || ms <= 0) return "—";
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.round(days / 30)}mo`;
}
