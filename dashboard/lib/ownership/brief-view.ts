import type { RepoDomain, RepoPrRadarRow, RepoTeam } from "./types";

export type PrRadarFilter = "all" | "review" | "unattended" | "stale";

export const PR_RADAR_FILTERS: { id: PrRadarFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "review", label: "Waiting on you" },
  { id: "unattended", label: "Nobody looking" },
  { id: "stale", label: "Stale" },
];

export function matchesPrRadarFilter(pr: RepoPrRadarRow, filter: PrRadarFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "review":
      return pr.review.mineRequested && !pr.isDraft;
    case "unattended":
      return pr.review.nobodyLooking && !pr.isDraft;
    case "stale":
      return pr.stale && !pr.isDraft;
  }
}

export function filterPrRadar(prs: RepoPrRadarRow[], filter: PrRadarFilter): RepoPrRadarRow[] {
  return rankPrRadar(prs.filter((pr) => matchesPrRadarFilter(pr, filter)));
}

export function prRadarFilterCounts(prs: RepoPrRadarRow[]): Record<PrRadarFilter, number> {
  return {
    all: prs.length,
    review: prs.filter((pr) => matchesPrRadarFilter(pr, "review")).length,
    unattended: prs.filter((pr) => matchesPrRadarFilter(pr, "unattended")).length,
    stale: prs.filter((pr) => matchesPrRadarFilter(pr, "stale")).length,
  };
}

/**
 * Catch-up order: your review queue, then unattended inbound, then stale, then
 * the rest. Drafts sink. Updated-at breaks ties so the noisy one is on top.
 */
export function rankPrRadar(prs: RepoPrRadarRow[]): RepoPrRadarRow[] {
  return [...prs].sort((a, b) => {
    const rank = prRank(a) - prRank(b);
    if (rank !== 0) return rank;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export interface DeclaredOwnerRow {
  domainId: string;
  label: string;
  codeowners: string[];
  teamLabel: string | null;
  teamSource: Extract<RepoTeam["source"], "override" | "codeowners"> | null;
}

export interface InferredOwnerRow {
  id: string;
  label: string;
  members: string[];
  domainLabels: string[];
}

export interface RepoOwnersView {
  declared: DeclaredOwnerRow[];
  inferred: InferredOwnerRow[];
}

/**
 * CODEOWNERS / overrides are authority. Churn groupings are familiarity and
 * must stay in `inferred` so the UI cannot present them as owners.
 */
export function presentRepoOwners(domains: RepoDomain[], teams: RepoTeam[]): RepoOwnersView {
  const declaredTeams = teams.filter(
    (team): team is RepoTeam & { source: "override" | "codeowners" } =>
      team.source === "override" || team.source === "codeowners",
  );
  const declared: DeclaredOwnerRow[] = domains
    .filter((domain) => domain.codeowners.length > 0)
    .map((domain) => {
      const team = declaredTeams.find((candidate) => candidate.domains.includes(domain.id));
      return {
        domainId: domain.id,
        label: domain.label,
        codeowners: domain.codeowners,
        teamLabel: team?.label ?? null,
        teamSource: team?.source ?? null,
      };
    });

  const inferred: InferredOwnerRow[] = teams
    .filter((team) => team.source === "churn")
    .map((team) => ({
      id: team.id,
      label: team.label,
      members: team.members,
      domainLabels: team.domains.flatMap((id) => {
        const domain = domains.find((candidate) => candidate.id === id);
        return domain ? [domain.label] : [];
      }),
    }));

  return { declared, inferred };
}

function prRank(pr: RepoPrRadarRow): number {
  if (pr.isDraft) return 5;
  if (pr.review.mineRequested) return 0;
  if (pr.review.nobodyLooking) return 1;
  if (pr.stale) return 2;
  if (pr.checks === "failing") return 3;
  return 4;
}
