"use client";

import { GitBranch } from "lucide-react";
import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSWRConfig } from "swr";
import { EmptyState, FetchError, SkeletonRows } from "@/components";
import { RepoGitWorkspace } from "@/components/repo-git/RepoGitWorkspace";
import type { RepoGitTabId } from "@/components/repo-git/RepoGitWorkspace";
import { useLive } from "@/lib/hooks/use-fetch";
import { useRouteHistoryLabel } from "@/lib/hooks/use-session-history";
import type { RepoInfo, ReposApiPayload } from "../../types";

const TAB_IDS: ReadonlySet<string> = new Set([
  "history",
  "changes",
  "branches",
  "stash",
  "conflicts",
  "blame",
  "worktrees",
  "reflog",
]);

export function RepoGitPage({ name }: { name: string }) {
  useRouteHistoryLabel(name);
  const search = useSearchParams();
  const tabParam = search.get("tab");
  const initialTab =
    tabParam && TAB_IDS.has(tabParam) ? (tabParam as RepoGitTabId) : undefined;
  const focusPath = search.get("path");
  const initialFocusUnpushed = search.get("unpushed") === "1";
  const focusRequest = `${name}:${search.toString()}`;
  const [consumedFocus, setConsumedFocus] = useState<string | null>(null);
  const consumeFocus = useCallback(() => setConsumedFocus(focusRequest), [focusRequest]);
  const { cache, mutate: mutateKey } = useSWRConfig();
  const listed = (cache.get("/api/repos")?.data as ReposApiPayload | undefined)?.repos.find(
    (candidate) => candidate.name === name,
  );
  const { data, error, isLoading, mutate } = useLive<{ repo: RepoInfo }>(
    `/api/repos/${encodeURIComponent(name)}`,
    { fallbackData: listed ? { repo: listed } : undefined },
  );
  const repo = data?.repo ?? null;

  if (error && !repo) {
    if (error.message === "Repo not found") {
      return (
        <div className="page-wrapper">
          <EmptyState
            icon={<GitBranch size={32} />}
            title="Repo not found"
            subtitle={`No local clone named "${name}".`}
          />
        </div>
      );
    }
    return (
      <div className="page-wrapper">
        <FetchError message={error.message} onRetry={() => void mutate()} />
      </div>
    );
  }
  if (isLoading && !repo) {
    return (
      <div className="page-wrapper">
        <SkeletonRows count={6} />
      </div>
    );
  }
  if (!repo) {
    return (
      <div className="page-wrapper">
        <EmptyState
          icon={<GitBranch size={32} />}
          title="Repo not found"
          subtitle={`No local clone named "${name}".`}
        />
      </div>
    );
  }

  return (
    <div className="repo-git-page">
      {error && <FetchError message={error.message} onRetry={() => void mutate()} bare />}
      <RepoGitWorkspace
        key={focusRequest}
        repoName={repo.name}
        repoPath={repo.path}
        dirtyCount={repo.dirtyCount}
        unpushedCount={repo.unpushedCount ?? 0}
        onMutate={() => {
          void mutate();
          void mutateKey("/api/repos");
          void mutateKey("/api/status/git");
        }}
        variant="page"
        hideTrigger
        initialTab={focusPath ? "changes" : initialFocusUnpushed ? "history" : initialTab}
        initialFocusUnpushed={initialFocusUnpushed}
        focusPath={consumedFocus === focusRequest ? null : focusPath}
        onFocusPathConsumed={consumeFocus}
      />
    </div>
  );
}
