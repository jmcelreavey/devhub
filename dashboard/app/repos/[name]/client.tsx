"use client";

import Link from "next/link";
import { GitBranch } from "lucide-react";
import { useSWRConfig } from "swr";
import { EmptyState, FetchError, PageHeader, SkeletonRows } from "@/components";
import { RepoOpenPrLink } from "@/components/repos/RepoOpenPrLink";
import { RepoActionBar } from "@/components/repo-hub/RepoActionBar";
import { RepoWorkHub } from "@/components/repo-hub/RepoWorkHub";
import { useLive } from "@/lib/hooks/use-fetch";
import { useRouteHistoryLabel } from "@/lib/hooks/use-session-history";
import { useReposActions } from "../useReposActions";
import type { RepoInfo, ReposApiPayload } from "../types";

export function RepoHub({ name }: { name: string }) {
  useRouteHistoryLabel(name);
  const { cache, mutate: mutateKey } = useSWRConfig();
  // Arriving from /repos, the list already holds this repo — paint it at once
  // and let the single-repo read refresh it, instead of a skeleton page.
  const listed = (cache.get("/api/repos")?.data as ReposApiPayload | undefined)?.repos.find(
    (candidate) => candidate.name === name,
  );
  const { data, error, isLoading, mutate } = useLive<{ repo: RepoInfo }>(
    `/api/repos/${encodeURIComponent(name)}`,
    { fallbackData: listed ? { repo: listed } : undefined },
  );
  const repo = data?.repo ?? null;
  const refresh = () => {
    void mutate();
    // The list page shows the same counts; keep it honest for the trip back.
    void mutateKey("/api/repos");
  };
  const actions = useReposActions({
    mutateLocal: async () => refresh(),
    mutateGithub: async () => undefined,
  });

  if (error && !repo) {
    if (error.message === "Repo not found") {
      return <div className="page-wrapper"><EmptyState icon={<GitBranch size={32} />} title="Repo not found" subtitle={`No local clone named "${name}".`} /></div>;
    }
    return <div className="page-wrapper"><FetchError message={error.message} onRetry={() => void mutate()} /></div>;
  }
  if (isLoading && !repo) return <div className="page-wrapper"><SkeletonRows count={6} /></div>;
  if (!repo) {
    return <div className="page-wrapper"><EmptyState icon={<GitBranch size={32} />} title="Repo not found" subtitle={`No local clone named "${name}".`} /></div>;
  }

  return (
    <div className="page-wrapper">
      <PageHeader
        title={repo.name}
        subtitle={<span className="font-mono break-all">{repo.path}</span>}
        badge={
          <span className="flex flex-wrap items-center gap-1.5">
            <Link className="badge badge-muted" href={`/repos/${encodeURIComponent(repo.name)}/git?tab=worktrees`}>{repo.worktreeCount ?? "?"} worktrees{repo.staleWorktreeCount ? ` · ${repo.staleWorktreeCount} stale` : ""}</Link>
            {repo.branch ? <span className="badge badge-muted"><GitBranch size={11} /> {repo.branch}</span> : null}
            {repo.branch && repo.remote ? <RepoOpenPrLink repoName={repo.name} branch={repo.branch} /> : null}
            <span className={repo.dirtyCount ? "badge badge-warning" : "badge badge-success"}>{repo.dirtyCount ? `${repo.dirtyCount} changed` : "clean"}</span>
            {(repo.unpushedCount ?? 0) > 0 ? <span className="repo-unpushed-badge">{repo.unpushedCount} unpushed</span> : null}
          </span>
        }
        actions={<RepoActionBar repo={repo} actions={actions} />}
      />

      <RepoWorkHub repo={repo} onMutate={refresh} />
    </div>
  );
}
