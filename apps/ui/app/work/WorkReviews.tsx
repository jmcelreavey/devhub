"use client";

import { useMemo, useState } from "react";
import { PrReviewsColumn } from "@/app/storyboard/PrReviewsColumn";
import { OwnedPrsPanel } from "@/components/prs/OwnedPrsPanel";
import { FetchError } from "@/components/ui/FetchError";
import { InlineSearch } from "@/components/ui/InlineSearch";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { useOwnedPrs } from "@/lib/github/use-owned-prs";
import { useLive } from "@/lib/hooks/use-fetch";
import { reviewedPrs, type ReviewNoteSummary } from "@/lib/storyboard/reviewed-prs";
import type { GithubPrsApiPayload } from "@shared/github/pr-types";
import { profileKey } from "@shared/tasks/profile-scope";
import type { TaskProfileOverview } from "@shared/tasks/profile-types";
import { filterPrRows } from "../../../../packages/shared/ui-lib/github/pr-search";

export default function WorkReviews() {
  const [query, setQuery] = useState("");
  const [notesOpen, setNotesOpen] = useState(true);
  const profile = useLive<TaskProfileOverview>("/api/tasks/profiles", { refreshInterval: 0 });
  const profileId = !profile.error && profile.data ? profile.data.active ?? "legacy" : undefined;
  const owned = useOwnedPrs(profileId);
  const requested = useLive<GithubPrsApiPayload>(profileId ? profileKey("/api/github/prs", profileId) : null, { refreshInterval: 60_000 });
  const notes = useLive<{ notes: ReviewNoteSummary[] }>(profileId ? "/api/storyboard/pr-review-notes" : null);
  const reviewed = useMemo(() => {
    const unique = new Map([...(owned.data?.prs ?? []), ...(requested.data?.reviews ?? [])].map((pr) => [pr.url, pr]));
    return reviewedPrs(filterPrRows([...unique.values()], query), notes.data?.notes ?? []);
  }, [owned.data?.prs, requested.data?.reviews, notes.data?.notes, query]);

  if (profile.error) return <FetchError message="Could not confirm the active task profile." onRetry={() => void profile.mutate()} />;
  if (!profileId) return <SkeletonRows count={3} height={48} variant="list" />;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Pull request reviews</h2>
        <p className="text-sm text-text-muted">Open PRs in owned repositories and saved review notes. Task review stages remain on the board.</p>
      </div>
      <InlineSearch id="work-pr-search" label="Search pull requests" placeholder="Search PR title, repository or author…" value={query} onChange={setQuery} />
      <OwnedPrsPanel profile={profileId} query={query} />
      {(requested.error || requested.data?.stale || notes.error) ? <FetchError bare message="Could not refresh all saved review notes." onRetry={() => { void requested.mutate(); void notes.mutate(); }} /> : null}
      {reviewed.length > 0 ? <PrReviewsColumn items={reviewed} collapsed={!notesOpen} onToggle={() => setNotesOpen((open) => !open)} /> : null}
    </div>
  );
}
