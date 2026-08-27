"use client";

import Link from "next/link";
import { Bot, Code2, GitBranch, MessageSquare, NotebookPen, Rocket, TerminalSquare } from "lucide-react";
import { EmptyState, FetchError, PageHeader, SkeletonRows } from "@/components";
import { NoteListRow, type NoteListRowItem } from "@/components/notes/NoteListRow";
import { PrRow } from "@/components/PrRow";
import { RepoGitWorkspace } from "@/components/repo-git/RepoGitWorkspace";
import { HistoryPanel } from "@/components/repo-git/HistoryPanel";
import { useGithubPrSearch } from "@/lib/hooks/use-github-pr-search";
import { useLive } from "@/lib/hooks/use-fetch";
import { useRouteHistoryLabel } from "@/lib/hooks/use-session-history";
import { parseRepoFullNameFromRemote } from "@/lib/github/repo-url";
import { chatgptCliCommand, claudeCliCommand, openTerminal } from "@/lib/terminal-launch";
import { useReposActions } from "../useReposActions";
import type { RepoInfo, ReposApiPayload } from "../types";
import type { RepoProject } from "@/lib/projects";

interface RepoNotesPayload {
  notes: NoteListRowItem[];
}

function RepoActions({ repo, actions }: { repo: RepoInfo; actions: ReturnType<typeof useReposActions> }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" className="btn btn-ghost text-xs" onClick={() => void actions.openInCursor(repo.name)}>
        <Code2 size={13} /> Cursor
      </button>
      <button type="button" className="btn btn-ghost text-xs" onClick={() => actions.openInTerminal(repo)}>
        <TerminalSquare size={13} /> Terminal
      </button>
      <button
        type="button"
        className="btn btn-ghost text-xs"
        onClick={() => openTerminal({ cwd: repo.path, label: `Claude · ${repo.name}`, command: claudeCliCommand(), repoName: repo.name })}
      >
        <Bot size={13} /> Claude
      </button>
      <button
        type="button"
        className="btn btn-ghost text-xs"
        onClick={() => openTerminal({ cwd: repo.path, label: `ChatGPT · ${repo.name}`, command: chatgptCliCommand(), repoName: repo.name })}
      >
        <MessageSquare size={13} /> ChatGPT
      </button>
      <button type="button" className="btn btn-primary text-xs" onClick={() => void actions.openUpstart(repo)}>
        <Rocket size={13} /> Upstart
      </button>
    </div>
  );
}

export function RepoHub({ name }: { name: string }) {
  useRouteHistoryLabel(name);
  const { data, error, isLoading, mutate } = useLive<ReposApiPayload>("/api/repos");
  const repo = data?.repos.find((candidate) => candidate.name === name) ?? null;
  const fullName = parseRepoFullNameFromRemote(repo?.remote ?? null);
  const prs = useGithubPrSearch(fullName ? `repo:${fullName} is:open` : "", Boolean(fullName), 0);
  const notes = useLive<RepoNotesPayload>(repo ? `/api/repos/${encodeURIComponent(name)}/notes` : null, {
    refreshInterval: 0,
  });
  const actions = useReposActions({
    mutateLocal: () => mutate(),
    mutateGithub: async () => undefined,
  });
  const { data: projectsData } = useLive<{ projects: RepoProject[] }>("/api/projects", {
    refreshInterval: 0,
  });
  // First project claiming this repo wins; sibling links make the "frontend +
  // its app" hop a single click from either side.
  const project = projectsData?.projects.find((p) =>
    p.repos.some((r) => r.toLowerCase() === name.toLowerCase()),
  );

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
        actions={<RepoActions repo={repo} actions={actions} />}
      />

      {project && project.repos.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-text-subtle">
          <span>Project:</span>
          {project.repos.map((repoName) => (
            <Link
              key={repoName}
              href={`/repos/${encodeURIComponent(repoName)}`}
              className={`badge ${repoName.toLowerCase() === name.toLowerCase() ? "badge-accent" : "badge-muted"}`}
            >
              {repoName}
            </Link>
          ))}
        </div>
      )}

      <section className="mt-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h2 className="text-sm font-semibold text-text">Commits</h2>
          <RepoGitWorkspace repoName={repo.name} repoPath={repo.path} dirtyCount={repo.dirtyCount} unpushedCount={repo.unpushedCount ?? 0} onMutate={refresh} />
        </div>
        <div className="repo-hub-history repo-git-tab-body">
          <HistoryPanel repoName={repo.name} repoPath={repo.path} onMutate={refresh} />
        </div>
      </section>

      <div className="repo-hub-columns mt-5">
        <section>
          <h2 className="text-sm font-semibold text-text mb-2">Open PRs</h2>
          {prs.loading ? <SkeletonRows count={3} /> : prs.error ? (
            <FetchError message={prs.error} onRetry={prs.retry} />
          ) : prs.results.length ? (
            <div className="divide-y divide-border">{prs.results.map((row) => <PrRow key={row.url} row={row} kind="reviewed" />)}</div>
          ) : <p className="text-xs text-text-subtle">No open PRs.</p>}
        </section>
        <section>
          <h2 className="text-sm font-semibold text-text mb-2">Notes</h2>
          {notes.isLoading ? <SkeletonRows count={3} /> : notes.error ? <p className="text-xs text-danger">Could not load notes.</p> : notes.data?.notes.length ? (
            <ul className="lib-section-list">{notes.data.notes.map((note) => (
              <li key={note.slug}><NoteListRow note={note} className="lib-section-row"><NotebookPen size={14} className="lib-card-icon" /><span className="lib-section-row-title">{note.title}</span></NoteListRow></li>
            ))}</ul>
          ) : <p className="text-xs text-text-subtle">No indexed notes for this repo.</p>}
        </section>
      </div>
    </div>
  );
}
