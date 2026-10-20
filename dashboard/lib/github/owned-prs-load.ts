import { resolveOwnedRepos } from "@/lib/ownership/owned-repos";
import { loadPrRadar } from "@/lib/ownership/service";
import { pMap } from "@/lib/p-limit";
import { SUBPROCESS_CONCURRENCY } from "@/lib/standup/config";
import type { OwnedPrsResponse } from "./owned-prs";
import type { GithubPrRow } from "./prs";

/** Open PRs in the Owned repositories. The PRs page and Slack both read this, so there is one ownership rule. */
export async function loadOwnedPrs(): Promise<OwnedPrsResponse> {
  const repos = await resolveOwnedRepos();
  const results = await pMap(repos, SUBPROCESS_CONCURRENCY, async (repo) => {
    try {
      // Reuse /own's reader, cache and ownership registry. No second ownership rule.
      const radar = await loadPrRadar(repo);
      const prs: GithubPrRow[] = radar.map((pr) => ({
        repo: repo.fullName, number: pr.number, title: pr.title, url: pr.url,
        author: { login: pr.author.login }, updatedAt: pr.updatedAt,
        createdAt: pr.createdAt, draft: pr.isDraft, checks: pr.checks, prState: "open",
      }));
      return { prs, failedRepos: [], limited: radar.length >= 100 };
    } catch (error) {
      console.error(`[owned-prs:${repo.fullName}]`, error);
      return { prs: [], failedRepos: [repo.fullName], limited: false };
    }
  });
  return {
    prs: results.flatMap((result) => result.prs).sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")),
    failedRepos: results.flatMap((result) => result.failedRepos),
    limited: results.some((result) => result.limited),
  };
}
