import { loadOwnedPrs } from "@/lib/github/owned-prs-load";
import { loadGithubPrsList } from "@/lib/github/prs-list";
import type { SlackPrData } from "./pr-view";
import { listOwnedRepos } from "@/lib/ownership/owned-repos";

/** My PRs, review requests and the Owned repos' PRs, from the same readers the PRs page uses. */
export async function loadSlackPrs(): Promise<SlackPrData> {
  const prs = await loadGithubPrsList();
  if (!prs.configured) return { configured: false, authored: [], reviews: [], ownedFailed: [], stale: false };
  let owned: Awaited<ReturnType<typeof loadOwnedPrs>> | undefined;
  try { owned = await loadOwnedPrs(); } catch { owned = undefined; }
  return { configured: true, authored: prs.authored, reviews: prs.reviews, owned: owned?.prs, ownedRepos: listOwnedRepos().map((repo) => repo.fullName), ownedFailed: owned?.failedRepos ?? [], stale: prs.stale === true };
}
