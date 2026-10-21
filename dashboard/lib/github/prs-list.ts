import { githubScreen } from "@/lib/integrations/screen-data";
import { readGithubPrsListCache, readStaleGithubPrsListCache, writeGithubPrsListCache, type GithubPrRow, type GithubPrsApiPayload } from "./prs";
import { sortReviewRequestedPrs } from "./review-requested-sort";
import { listSkippedPrs } from "./skipped-prs";
import { isGithubCliAuthenticated, mapGithubCliError } from "@/lib/gh-exec";
import { getGithubLogin } from "@/lib/standup/github-merged";
import { reviewNoteActivityByPath } from "@/lib/notes/review-index-server";
import { pMap } from "@/lib/p-limit";
import { SUBPROCESS_CONCURRENCY } from "@/lib/standup/config";

function sortReviews(rows: GithubPrRow[]): GithubPrRow[] {
  return sortReviewRequestedPrs(rows, reviewNoteActivityByPath());
}

function withoutSkippedPrs(payload: GithubPrsApiPayload): GithubPrsApiPayload {
  const skipped = new Set(listSkippedPrs().map((pr) => pr.url));
  return { ...payload, authored: payload.authored.filter((pr) => !skipped.has(pr.url)), reviews: payload.reviews.filter((pr) => !skipped.has(pr.url)) };
}

export async function loadGithubPrsList(): Promise<GithubPrsApiPayload> {
  if (!await isGithubCliAuthenticated()) return { configured: false, authored: [], reviews: [], recentlyReviewed: [] };
  const cached = readGithubPrsListCache();
  if (cached) {
    const visible = withoutSkippedPrs(cached);
    return { ...visible, reviews: sortReviews(visible.reviews), cached: true, configured: true };
  }
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
    const visible = withoutSkippedPrs(stale);
    return { ...visible, reviews: sortReviews(visible.reviews), cached: true, stale: true, configured: true, warning: mapped.error };
  }
}
