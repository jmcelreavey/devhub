import { resolveOwnedRepos } from "../ownership/owned-repos";
import { loadPrRadar, loadRemotePrRadar } from "../ownership/service";
import type { RepoPrRadarRow, ResolvedOwnedRepo } from "../../../../../packages/shared/repos/ownership-types";
import { pMap } from "../p-limit";
import { SUBPROCESS_CONCURRENCY } from "../standup/config";
import type { OwnedPrsResponse } from "../../../../../packages/shared/ui-lib/github/owned-prs";
import type { GithubPrRow } from "../../../../../packages/shared/github/pr-types";

/** Open PRs in the Owned repositories. The PRs page and Slack both read this, so there is one ownership rule. */
export async function loadOwnedPrs(): Promise<OwnedPrsResponse> {
  const repos = await resolveOwnedRepos();
  return loadOwnedPrsFrom(repos, (repo) => repo.fullName, loadPrRadar);
}

export function loadRemoteOwnedPrs(repos: string[]): Promise<OwnedPrsResponse> {
  return loadOwnedPrsFrom(repos, (repo) => repo, loadRemotePrRadar);
}

async function loadOwnedPrsFrom<T extends string | ResolvedOwnedRepo>(
  repos: T[], name: (repo: T) => string, load: (repo: T) => Promise<RepoPrRadarRow[]>,
): Promise<OwnedPrsResponse> {
  const results = await pMap(repos, SUBPROCESS_CONCURRENCY, async (repo) => {
    try {
      const radar = await load(repo);
      const prs: GithubPrRow[] = radar.map((pr) => ({
        repo: name(repo), number: pr.number, title: pr.title, url: pr.url,
        author: { login: pr.author.login }, updatedAt: pr.updatedAt,
        createdAt: pr.createdAt, draft: pr.isDraft, checks: pr.checks, prState: "open",
      }));
      return { prs, failedRepos: [], limited: radar.length >= 100 };
    } catch (error) {
      console.error(`[owned-prs:${name(repo)}]`, error);
      return { prs: [], failedRepos: [name(repo)], limited: false };
    }
  });
  return {
    prs: results.flatMap((result) => result.prs).sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")),
    failedRepos: results.flatMap((result) => result.failedRepos),
    limited: results.some((result) => result.limited),
  };
}
