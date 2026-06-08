import { NextResponse } from "next/server";
import {
  fetchMyGithubPrs,
  fetchRecentlyReviewedPrs,
  isRepoArchived,
  type GithubPrsApiPayload,
  type GithubPrRow,
} from "@/lib/github-prs";
import { isGithubCliAuthenticated, mapGithubCliError } from "@/lib/gh-exec";
import { getGithubLogin } from "@/lib/standup-github-merged";

export const dynamic = "force-dynamic";

let cache: { data: GithubPrsApiPayload; ts: number } | null = null;
const TTL_MS = 2 * 60 * 1000;

export async function GET() {
  const configured = await isGithubCliAuthenticated();
  if (!configured) {
    return NextResponse.json({ configured: false, authored: [], reviews: [], recentlyReviewed: [] });
  }

  if (cache && Date.now() - cache.ts < TTL_MS) {
    return NextResponse.json({ ...cache.data, cached: true, configured: true });
  }

  try {
    const { authored, reviews } = await fetchMyGithubPrs();

    const uniqueRepos = [...new Set([...authored, ...reviews].map((r) => r.repo))];
    const archivedSet = new Set<string>();
    await Promise.all(
      uniqueRepos.map(async (repo) => {
        if (await isRepoArchived(repo)) archivedSet.add(repo);
      }),
    );
    const filterArchived = (rows: GithubPrRow[]) => rows.filter((r) => !archivedSet.has(r.repo));

    const filteredAuthored = filterArchived(authored);
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
    cache = { data: payload, ts: Date.now() };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[api:github:prs]", error);
    const mapped = mapGithubCliError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
}
