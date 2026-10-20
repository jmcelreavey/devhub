"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import type { TaskProfileOverview } from "@/lib/tasks/profile-types";
import { profileKey } from "@/lib/tasks/profile-scope";
import type { GithubPrsApiPayload } from "@/lib/github/prs";
import { prIdentity } from "@/lib/github/actionable-prs";
import { WorkDetailFrame } from "./WorkDetailFrame";
import { FetchError } from "@/components/ui/FetchError";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import styles from "./TaskDetailPanel.module.css";

export function PeerPrDetailPanel({ identity, requestedProfile, onClose }: { identity: string; requestedProfile?: string; onClose: () => void }) {
  const profile = useLive<TaskProfileOverview>("/api/tasks/profiles");
  const profileId = profile.data ? profile.data.active ?? "legacy" : undefined;
  const [openedProfile, setOpenedProfile] = useState(requestedProfile ?? profileId);
  if (openedProfile === undefined && profileId !== undefined) setOpenedProfile(profileId);
  const mismatch = openedProfile !== undefined && profileId !== undefined && openedProfile !== profileId;
  const prs = useLive<GithubPrsApiPayload>(mismatch ? null : profileKey("/api/github/prs", profileId));
  const mine = prs.data?.authored?.find((item) => prIdentity(item) === identity);
  const pr = mine ?? prs.data?.reviews?.find((item) => prIdentity(item) === identity);
  const unavailable = prs.error || prs.data?.stale || prs.data?.configured === false;
  return <WorkDetailFrame title={mismatch ? "Task profile changed" : pr?.title ?? "PR review"} identity="PR" onClose={onClose}>
    {mismatch ? <p role="alert" className="tone-panel tone-panel--warning">This detail was opened in {openedProfile}, but the active profile is now {profileId}. Close it and open work in the active profile.</p>
      : profile.error ? <FetchError bare message="Couldn't confirm the active task profile." onRetry={() => void profile.mutate()} />
      : !profile.data || (!prs.data && !prs.error) ? <div aria-busy="true" aria-label="Loading PR review"><SkeletonRows count={3} /></div>
      : <>
        {unavailable ? <FetchError bare message="GitHub unavailable. Last-known review details are shown." onRetry={() => void prs.mutate()} /> : null}
        {pr ? <>
          <p className={styles.context}>{pr.repo} · PR #{pr.number}{pr.author ? ` · @${pr.author.login}` : ""}</p>
          <p className={styles.status}>{mine ? "Your PR" : "Review requested"}{pr.checks ? ` · checks ${pr.checks}` : ""}{pr.draft ? " · draft" : ""}</p>
          <div className={styles.primary}><a className="btn btn-primary" href={pr.url} target="_blank" rel="noopener noreferrer">Open PR <ExternalLink size={13} aria-hidden /></a><p>Review and merge stay in GitHub. Opening this panel doesn’t create a task or start an agent.</p></div>
        </> : !unavailable ? <p role="status">This PR is no longer in the active review queue. <a href="/prs">Open PRs →</a></p> : null}
      </>}
  </WorkDetailFrame>;
}
