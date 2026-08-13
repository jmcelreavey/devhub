import type { DomainContribution, OwnedTeamOverride, RepoDomain, RepoTeam } from "./types";

/** A churn grouping needs this many commits behind it before it is worth showing. */
const MIN_CHURN_COMMITS = 3;
/** An author has to do this share of their work in a domain for it to be "theirs". */
const PRIMARY_DOMAIN_SHARE = 0.4;

const UNKNOWN_TEAM: RepoTeam = { id: "unknown", label: "Unknown", source: "unknown", domains: [], members: [] };

function fromOverrides(overrides: OwnedTeamOverride[]): RepoTeam[] {
  return overrides.map((team) => ({ ...team, source: "override" as const, members: [] }));
}

/**
 * Teams declared in CODEOWNERS. Only `@org/team` entries count — a bare
 * `@person` is an individual owner, not a team, and grouping the radar by
 * individual reviewers produces one bucket per person.
 */
function fromCodeowners(domains: RepoDomain[]): RepoTeam[] {
  const byOwner = new Map<string, string[]>();
  for (const domain of domains) {
    for (const owner of domain.codeowners) {
      if (!owner.startsWith("@") || !owner.includes("/")) continue;
      byOwner.set(owner, [...new Set([...(byOwner.get(owner) ?? []), domain.id])]);
    }
  }
  return [...byOwner].map(([owner, domainIds]) => ({
    id: owner.slice(1).replace("/", "-"),
    label: owner,
    source: "codeowners" as const,
    domains: domainIds,
    members: [],
  }));
}

/**
 * Third tier: cluster authors by where they actually commit.
 *
 * Deliberately conservative. An author is only assigned to a domain when a
 * clear plurality of their commits land there, and a grouping is only emitted
 * once enough commits back it — otherwise a single drive-by commit would invent
 * a team. Labels are prefixed with `~` so an inferred grouping never reads like
 * a declared owner.
 */
export function inferTeamsFromChurn(domains: RepoDomain[], contributions: DomainContribution[]): RepoTeam[] {
  const byAuthor = new Map<string, DomainContribution[]>();
  for (const contribution of contributions) {
    if (contribution.commits <= 0) continue;
    byAuthor.set(contribution.author, [...(byAuthor.get(contribution.author) ?? []), contribution]);
  }

  const membersByDomain = new Map<string, { members: Set<string>; commits: number }>();
  for (const [author, rows] of byAuthor) {
    const total = rows.reduce((sum, row) => sum + row.commits, 0);
    const primary = [...rows].sort((a, b) => b.commits - a.commits)[0];
    if (!primary || primary.commits / total < PRIMARY_DOMAIN_SHARE) continue;
    const entry = membersByDomain.get(primary.domainId) ?? { members: new Set<string>(), commits: 0 };
    entry.members.add(author);
    entry.commits += primary.commits;
    membersByDomain.set(primary.domainId, entry);
  }

  return [...membersByDomain]
    .filter(([, entry]) => entry.commits >= MIN_CHURN_COMMITS)
    .map(([domainId, entry]) => {
      const domain = domains.find((candidate) => candidate.id === domainId);
      return {
        id: `churn-${domainId}`,
        label: `~${domain?.label ?? domainId}`,
        source: "churn" as const,
        domains: [domainId],
        members: [...entry.members].sort(),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Resolve the grouping for a repo's PR radar, in descending order of authority:
 * explicit overrides, then CODEOWNERS teams, then churn inference, then a single
 * Unknown bucket.
 *
 * `contributions` is optional because computing it costs a `git log` over the
 * whole history — callers only gather it when the cheaper tiers came back empty.
 */
export function deriveTeams(
  domains: RepoDomain[],
  overrides: OwnedTeamOverride[] | null = null,
  contributions: DomainContribution[] | null = null,
): RepoTeam[] {
  if (overrides?.length) return fromOverrides(overrides);

  const declared = fromCodeowners(domains);
  if (declared.length) return declared;

  const inferred = contributions?.length ? inferTeamsFromChurn(domains, contributions) : [];
  return inferred.length ? inferred : [UNKNOWN_TEAM];
}

/** True when the cheap tiers produced nothing, so churn inference is worth its cost. */
export function needsChurnInference(teams: RepoTeam[]): boolean {
  return teams.length === 1 && teams[0]?.source === "unknown";
}

export function teamForDomains(teams: RepoTeam[], domainIds: string[]): string {
  return teams.find((team) => team.domains.some((domain) => domainIds.includes(domain)))?.label ?? "Unknown";
}
