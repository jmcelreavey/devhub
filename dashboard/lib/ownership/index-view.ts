import { formatRelativePastAge } from "@/lib/utils";
import type { AttentionSummary } from "./obligations";
import type { RepoPrRadarRow, ResolvedOwnedRepo } from "./types";

export type OwnIndexFilter = "all" | "neglected" | "review" | "open-prs" | "missing-clone";

export const OWN_INDEX_FILTERS: { id: OwnIndexFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "neglected", label: "Neglected" },
  { id: "review", label: "Waiting on you" },
  { id: "open-prs", label: "Open PRs" },
  { id: "missing-clone", label: "No clone" },
];

/** The cheap PR counts the index can show without loading gaps or catch-up. */
export interface OwnedIndexSignals {
  repo: Pick<
    ResolvedOwnedRepo,
    "fullName" | "name" | "lastVisited" | "localPath" | "localRepoName"
  >;
  openPrs: number;
  reviewRequested: number;
  unattended: number;
  attention: Pick<AttentionSummary, "score">;
  error: string | null;
}

export function prRadarCounts(prs: RepoPrRadarRow[]): {
  openPrs: number;
  reviewRequested: number;
  unattended: number;
} {
  const live = prs.filter((pr) => !pr.isDraft);
  return {
    openPrs: prs.length,
    reviewRequested: live.filter((pr) => pr.review.mineRequested).length,
    unattended: live.filter((pr) => pr.review.nobodyLooking).length,
  };
}

export function matchesOwnIndexFilter(row: OwnedIndexSignals, filter: OwnIndexFilter): boolean {
  if (row.error) return filter === "all" || filter === "neglected";
  switch (filter) {
    case "all":
      return true;
    case "neglected":
      return row.attention.score > 0 || row.repo.lastVisited === null;
    case "review":
      return row.reviewRequested > 0;
    case "open-prs":
      return row.openPrs > 0;
    case "missing-clone":
      return !row.repo.localPath;
  }
}

/**
 * Triage order for `/own`: urgency first, then the repos you have not looked
 * at, then name. Alphabetical order is for the per-repo tab strip, not this.
 */
export function sortOwnedIndex<T extends OwnedIndexSignals>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const score = b.attention.score - a.attention.score;
    if (score !== 0) return score;
    const visited = compareLastVisited(a.repo.lastVisited, b.repo.lastVisited);
    if (visited !== 0) return visited;
    return a.repo.fullName.localeCompare(b.repo.fullName);
  });
}

export function presentOwnedIndex<T extends OwnedIndexSignals>(
  rows: T[],
  filter: OwnIndexFilter,
): T[] {
  return sortOwnedIndex(rows.filter((row) => matchesOwnIndexFilter(row, filter)));
}

export function ownIndexFilterCounts<T extends OwnedIndexSignals>(
  rows: T[],
): Record<OwnIndexFilter, number> {
  return {
    all: rows.length,
    neglected: rows.filter((row) => matchesOwnIndexFilter(row, "neglected")).length,
    review: rows.filter((row) => matchesOwnIndexFilter(row, "review")).length,
    "open-prs": rows.filter((row) => matchesOwnIndexFilter(row, "open-prs")).length,
    "missing-clone": rows.filter((row) => matchesOwnIndexFilter(row, "missing-clone")).length,
  };
}

export function catchUpLabel(lastVisited: string | null, now = Date.now()): string {
  if (!lastVisited) return "Never caught up";
  const ts = Date.parse(lastVisited);
  if (Number.isNaN(ts)) return "Never caught up";
  return `Last look ${formatRelativePastAge(Math.max(0, now - ts))}`;
}

export function ownedCardMeta(row: OwnedIndexSignals, now = Date.now()): string {
  const parts = [
    row.repo.localPath
      ? `Local clone: ${row.repo.localRepoName ?? row.repo.name}`
      : "GitHub-only until cloned",
  ];
  if (!row.error) {
    parts.push(`${row.openPrs} open PR${row.openPrs === 1 ? "" : "s"}`);
    if (row.reviewRequested > 0) {
      parts.push(`${row.reviewRequested} waiting on you`);
    }
  }
  parts.push(catchUpLabel(row.repo.lastVisited, now));
  return parts.join(" · ");
}

function compareLastVisited(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a.localeCompare(b);
}
