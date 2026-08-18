import { NextResponse } from "next/server";
import {
  fetchMyGithubPrs,
  fetchRecentlyReviewedPrs,
  isRepoArchived,
  readGithubPrsListCache,
  writeGithubPrsListCache,
  type GithubPrRow,
} from "@/lib/github/prs";
import { attachRequestedReviewers } from "@/lib/github/request-reviewers";
import { isGithubCliAuthenticated, mapGithubCliError } from "@/lib/gh-exec";
import { getGithubLogin } from "@/lib/standup/github-merged";
import { pMap } from "@/lib/p-limit";
import { SUBPROCESS_CONCURRENCY } from "@/lib/standup/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const configured = await isGithubCliAuthenticated();
  if (!configured) {
    return NextResponse.json({ configured: false, authored: [], reviews: [], recentlyReviewed: [] });
  }

  const cached = readGithubPrsListCache();
  if (cached) {
    return NextResponse.json({ ...cached, cached: true, configured: true });
  }

  try {
    const { authored, reviews } = await fetchMyGithubPrs();

    const uniqueRepos = [...new Set([...authored, ...reviews].map((r) => r.repo))];
    const archivedSet = new Set<string>();
    // Capped: one `gh repo view` subprocess per repo, and the buckets can now
    // hold 100 rows each.
    await pMap(uniqueRepos, SUBPROCESS_CONCURRENCY, async (repo) => {
      if (await isRepoArchived(repo)) archivedSet.add(repo);
    });
    const filterArchived = (rows: GithubPrRow[]) => rows.filter((r) => !archivedSet.has(r.repo));

    const filteredAuthored = await attachRequestedReviewers(filterArchived(authored));
    const filteredReviews = filterArchived(reviews);

    const excludeUrls = new Set([
      ...filteredAuthored.map((r) => r.url),
      ...filteredReviews.map((r) => r.url),
    ]);

    let recentlyReviewed = [] as Awaited<ReturnType<typeof fetchRecentlyReviewedPrs>>;
    const login = await getGithubLogin();
    if (login) {
      recentlyReviewed = await fetchRecentlyReviewedPrs(login, excludeUrls);
    }

    const payload = {
      configured: true,
      authored: filteredAuthored,
      reviews: filteredReviews,
      recentlyReviewed,
      cached: false,
    };
    writeGithubPrsListCache(payload);
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[api:github:prs]", error);
    const mapped = mapGithubCliError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}
