"use client";

import { GitBranch } from "lucide-react";
import { EmptyState, FetchError, PageHeader, SkeletonRows } from "@/components";
import { RepoActionBar } from "@/components/repo-hub/RepoActionBar";
import { RepoWorkHub } from "@/components/repo-hub/RepoWorkHub";
import { useLive } from "@/lib/hooks/use-fetch";
import { useRouteHistoryLabel } from "@/lib/hooks/use-session-history";
import { useReposActions } from "../useReposActions";
import type { ReposApiPayload } from "../types";

export function RepoHub({ name }: { name: string }) {
  useRouteHistoryLabel(name);
  const { data, error, isLoading, mutate } = useLive<ReposApiPayload>("/api/repos");
  const repo = data?.repos.find((candidate) => candidate.name === name) ?? null;
  const actions = useReposActions({
    mutateLocal: () => mutate(),
    mutateGithub: async () => undefined,
  });

  if (error) return <div className="page-wrapper"><FetchError message={error.message} onRetry={() => void mutate()} /></div>;
  if (isLoading) return <div className="page-wrapper"><SkeletonRows count={6} /></div>;
  if (!repo) {
    return <div className="page-wrapper"><EmptyState icon={<GitBranch size={32} />} title="Repo not found" subtitle={`No local clone named "${name}".`} /></div>;
  }

  const refresh = () => void mutate();
  return (
    <div className="page-wrapper">
      <PageHeader
        title={repo.name}
        subtitle={<span className="font-mono">{repo.path}</span>}
        badge={
          <span className="flex flex-wrap items-center gap-1.5">
            {repo.branch ? <span className="badge badge-muted"><GitBranch size={11} /> {repo.branch}</span> : null}
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
