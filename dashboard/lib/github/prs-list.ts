import { githubScreen } from "@/lib/integrations/screen-data";
import { readGithubPrsListCache, readStaleGithubPrsListCache, writeGithubPrsListCache, type GithubPrRow, type GithubPrsApiPayload } from "./prs";
import { sortReviewRequestedPrs } from "./review-requested-sort";
import { isGithubCliAuthenticated, mapGithubCliError } from "@/lib/gh-exec";
import { getGithubLogin } from "@/lib/standup/github-merged";
import { reviewNoteActivityByPath } from "@/lib/notes/review-index-server";
import { pMap } from "@/lib/p-limit";
import { SUBPROCESS_CONCURRENCY } from "@/lib/standup/config";

function sortReviews(rows: GithubPrRow[]): GithubPrRow[] {
  return sortReviewRequestedPrs(rows, reviewNoteActivityByPath());
}

export async function loadGithubPrsList(): Promise<GithubPrsApiPayload> {
  if (!await isGithubCliAuthenticated()) return { configured: false, authored: [], reviews: [], recentlyReviewed: [] };
  const cached = readGithubPrsListCache();
  if (cached) return { ...cached, reviews: sortReviews(cached.reviews), cached: true, configured: true };
  try {
    const { authored, reviews, feedbackPrs } = await githubScreen.prs();
    const uniqueRepos = [...new Set([...authored, ...reviews].map((row) => row.repo))];
    const archived = new Set<string>();
    await pMap(uniqueRepos, SUBPROCESS_CONCURRENCY, async (repo) => {
      if (await githubScreen.archived(repo)) archived.add(repo);
    });
    const filteredAuthored = authored.filter((row) => !archived.has(row.repo));
    const filteredReviews = sortReviews(reviews.filter((row) => !archived.has(row.repo)));
    const excludeUrls = new Set([...filteredAuthored, ...filteredReviews].map((row) => row.url));
    const login = await getGithubLogin();
    const payload: GithubPrsApiPayload = {
      generatedAt: new Date().toISOString(), configured: true, authored: filteredAuthored, reviews: filteredReviews, feedbackPrs,
      recentlyReviewed: login ? await githubScreen.recentlyReviewed(login, excludeUrls) : [], cached: false,
    };
    writeGithubPrsListCache(payload);
    return payload;
  } catch (error) {
    const mapped = mapGithubCliError(error);
    const stale = mapped.status >= 500 ? readStaleGithubPrsListCache() : null;
    if (!stale) throw error;
    return { ...stale, reviews: sortReviews(stale.reviews), cached: true, stale: true, configured: true, warning: mapped.error };
  }
}
