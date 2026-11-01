import { githubScreen } from "../integrations/screen-data";
import { fetchPrFeedbackMeta, fetchPrListMetaByUrl, readGithubPrsListCache, readStaleGithubPrsListCache, writeGithubPrsListCache, type GithubPrRow, type GithubPrsApiPayload } from "./prs";
import { sortReviewRequestedPrs } from "./review-requested-sort";
import { listSkippedPrs } from "./skipped-prs";
import { isGithubCliAuthenticated, mapGithubCliError } from "../gh-exec";
import { getGithubLogin } from "../standup/github-merged";
import { reviewNoteActivityByPath } from "../notes/review-index-server";
import { pMap } from "../p-limit";
import { SUBPROCESS_CONCURRENCY } from "../standup/config";

function sortReviews(rows: GithubPrRow[]): GithubPrRow[] {
  return sortReviewRequestedPrs(rows, reviewNoteActivityByPath());
}

function withoutSkippedPrs(payload: GithubPrsApiPayload): GithubPrsApiPayload {
  const skipped = new Set(listSkippedPrs().map((pr) => pr.url));
  return { ...payload, authored: payload.authored.filter((pr) => !skipped.has(pr.url)), reviews: payload.reviews.filter((pr) => !skipped.has(pr.url)) };
}

let enrichment: { generation: string | undefined; promise: Promise<GithubPrsApiPayload> } | undefined;

async function enrich(base: GithubPrsApiPayload): Promise<GithubPrsApiPayload> {
  try {
    const rows = [...base.authored, ...base.reviews];
    const meta = await fetchPrListMetaByUrl(rows);
    const feedback = await fetchPrFeedbackMeta().catch(() => null);
    const warnings = [meta.warning, feedback?.warning, !feedback ? "PR feedback is unavailable. Retry to refresh it." : undefined].filter((value): value is string => !!value);
    const archived = new Set<string>();
    await pMap([...new Set(rows.map(row => row.repo))], SUBPROCESS_CONCURRENCY, async repo => {
      try { if (await githubScreen.archived(repo)) archived.add(repo); }
      catch { warnings.push("Some repository status is unavailable. Retry to refresh it."); }
    });
    const withMeta = (row: GithubPrRow): GithubPrRow => ({ ...row, ...meta.get(row.url) });
    let recentlyReviewed = base.recentlyReviewed ?? [];
    try {
      const login = await getGithubLogin();
      if (login) recentlyReviewed = await githubScreen.recentlyReviewed(login, new Set(rows.map(row => row.url)));
    } catch { warnings.push("Recent reviews are unavailable. The last loaded reviews are kept."); }
    const warning = [...new Set(warnings)].join(" ") || undefined;
    const payload: GithubPrsApiPayload = {
      ...base, detailsState: warning ? "partial" : "ready", detailsWarning: warning,
      authored: base.authored.filter(row => !archived.has(row.repo)).map(withMeta),
      reviews: sortReviews(base.reviews.filter(row => !archived.has(row.repo)).map(withMeta)),
      feedbackPrs: feedback ? [...feedback.values()].flatMap(item => item.feedback ? [item.feedback] : []) : base.feedbackPrs ?? [],
      recentlyReviewed,
    };
    // A late request must not replace a newer refresh or resurrect a skipped PR.
    if (readGithubPrsListCache()?.generatedAt === base.generatedAt) writeGithubPrsListCache(withoutSkippedPrs(payload));
    return withoutSkippedPrs(payload);
  } catch (error) {
    const partial: GithubPrsApiPayload = { ...withoutSkippedPrs(base), detailsState: "partial", detailsWarning: mapGithubCliError(error).error };
    if (readGithubPrsListCache()?.generatedAt === base.generatedAt) writeGithubPrsListCache(partial);
    return partial;
  }
}

function startEnrichment(base: GithubPrsApiPayload): Promise<GithubPrsApiPayload> {
  if (!enrichment || enrichment.generation !== base.generatedAt) {
    const pending = { generation: base.generatedAt, promise: enrich(base) };
    enrichment = pending;
    void pending.promise.finally(() => { if (enrichment === pending) enrichment = undefined; });
  }
  return enrichment.promise;
}

export async function loadGithubPrsList(details = false): Promise<GithubPrsApiPayload> {
  if (!await isGithubCliAuthenticated()) return { configured: false, authored: [], reviews: [], recentlyReviewed: [] };
  const cached = readGithubPrsListCache();
  if (cached) {
    if (cached.detailsState === "pending" || (details && cached.detailsState === "partial")) {
      const pending = startEnrichment(cached);
      if (details) return pending;
    }
    const visible = withoutSkippedPrs(cached);
    return { ...visible, reviews: sortReviews(visible.reviews), cached: true, configured: true };
  }
  try {
    const { authored, reviews } = await githubScreen.prs({ includeDetails: false });
    const previous = readStaleGithubPrsListCache();
    const payload: GithubPrsApiPayload = {
      generatedAt: new Date().toISOString(), configured: true,
      authored: authored.map(row => ({ ...previous?.authored.find(old => old.url === row.url), ...row })),
      reviews: sortReviews(reviews.map(row => ({ ...previous?.reviews.find(old => old.url === row.url), ...row }))),
      feedbackPrs: previous?.feedbackPrs ?? [],
      recentlyReviewed: previous?.recentlyReviewed ?? [], detailsState: "pending", cached: false,
    };
    writeGithubPrsListCache(payload);
    const pending = startEnrichment(payload);
    return details ? pending : withoutSkippedPrs(payload);
  } catch (error) {
    const mapped = mapGithubCliError(error);
    const stale = mapped.status >= 500 ? readStaleGithubPrsListCache() : null;
    if (!stale) throw error;
    const visible = withoutSkippedPrs(stale);
    return { ...visible, reviews: sortReviews(visible.reviews), cached: true, stale: true, configured: true, warning: mapped.error };
  }
}
