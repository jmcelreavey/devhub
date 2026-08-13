import { loadCouplingIndex, suggestCompanions } from "@/lib/git/change-coupling";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { loadRepoPeople } from "@/lib/people/repo-people";
import type { OwnedDomainOverride } from "@/lib/ownership/types";
import { deriveDomains, domainForPath } from "./domains";

export async function analyzeChangeImpact(
  repoRoot: string,
  cacheKey: string,
  paths: string[],
  overrides: OwnedDomainOverride[] | null = null,
) {
  const domains = await deriveDomains(repoRoot, overrides);
  const index = await loadCouplingIndex(repoRoot, cacheKey);
  const people = await loadRepoPeople(repoRoot);
  const log = await runGitRepoAsync(repoRoot, [
    "log", "--all", "--max-count=600", "--format=%ae%x00%aI", "--", ...paths,
  ]);
  const touches = new Map<string, { count: number; lastTouchedAt: string }>();
  for (const line of log.stdout.split("\n")) {
    if (!line.includes("\0")) continue;
    const [email = "", committedAt = ""] = line.split("\0");
    const key = email.toLowerCase();
    const current = touches.get(key) ?? { count: 0, lastTouchedAt: committedAt };
    touches.set(key, { count: current.count + 1, lastTouchedAt: current.lastTouchedAt || committedAt });
  }
  const reviewers = new Map<string, { person: (typeof people.people)[number]; touches: number; lastTouchedAt: string }>();
  for (const [email, activity] of touches) {
    const person = people.byEmail[email];
    if (!person) continue;
    const current = reviewers.get(person.key);
    reviewers.set(person.key, {
      person,
      touches: (current?.touches ?? 0) + activity.count,
      lastTouchedAt: current?.lastTouchedAt && current.lastTouchedAt > activity.lastTouchedAt
        ? current.lastTouchedAt
        : activity.lastTouchedAt,
    });
  }
  const domainCounts = new Map<string, number>();
  for (const filePath of paths) {
    const domain = domainForPath(domains, filePath);
    if (domain) domainCounts.set(domain.label, (domainCounts.get(domain.label) ?? 0) + 1);
  }
  return {
    domains: [...domainCounts].map(([label, changedFiles]) => ({ label, changedFiles })).sort((a, b) => b.changedFiles - a.changedFiles),
    companions: index ? suggestCompanions(index, paths, { limit: 8 }) : [],
    reviewers: [...reviewers.values()].sort((a, b) => b.touches - a.touches).slice(0, 5),
    commitsAnalysed: index?.commitsAnalysed ?? 0,
  };
}
