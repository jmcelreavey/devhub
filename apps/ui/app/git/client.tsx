"use client";

import { AlertTriangle, ArrowDown, ArrowUp, GitBranch, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, FetchError, SkeletonRows } from "@/components";
import { RepoGitWorkspace } from "@/components/repo-git/RepoGitWorkspace";
import { needsAttention, relativeAge } from "@/lib/git/overview";
import { useLive } from "@/lib/hooks/use-fetch";
import { useStoredState } from "@/lib/hooks/use-stored-state";
import type { RepoGitOverviewPayload, RepoGitOverviewRepo } from "@shared/repos/types";

type RailFilter = "attention" | "conflicts" | "dirty" | "behind" | "unpushed" | "all";

const FILTERS: { id: RailFilter; label: string }[] = [
  { id: "attention", label: "Needs attention" },
  { id: "conflicts", label: "Conflicts" },
  { id: "dirty", label: "Changed" },
  { id: "behind", label: "Behind" },
  { id: "unpushed", label: "Unpushed" },
  { id: "all", label: "All" },
];

function matchesFilter(repo: RepoGitOverviewRepo, filter: RailFilter): boolean {
  switch (filter) {
    case "attention":
      return needsAttention(repo);
    case "conflicts":
      return repo.conflictCount > 0;
    case "dirty":
      return repo.dirtyCount > 0;
    case "behind":
      return repo.behind > 0;
    case "unpushed":
      return repo.ahead > 0;
    case "all":
      return true;
  }
}

function filterCount(repos: RepoGitOverviewRepo[], filter: RailFilter): number {
  return repos.filter((repo) => matchesFilter(repo, filter)).length;
}

/**
 * Cross-repo Git hub: one rail listing every local clone with its git state,
 * one pane with the full workflow for the selected repo. The pane is the same
 * RepoGitWorkspace used on /repos/:name — this page changes where you enter,
 * not what the workspace does.
 */
const OVERVIEW_CACHE_KEY = "devhub:git-hub:overview";

function readCachedOverview(): RepoGitOverviewPayload | undefined {
  try {
    const raw = window.localStorage.getItem(OVERVIEW_CACHE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as RepoGitOverviewPayload;
    return Array.isArray(parsed.repos) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function GitHubPage() {
  // Paint the rail from the last snapshot immediately; the live fetch replaces it.
  const [cachedOverview] = useState(readCachedOverview);
  const { data, error, isLoading, mutate } = useLive<RepoGitOverviewPayload>("/api/git/overview", {
    fallbackData: cachedOverview,
  });
  const [selectedName, setSelectedName] = useStoredState<string>(
    "devhub:git-hub:selected",
    "",
    (raw) => raw || undefined,
    String,
  );
  const [filter, setFilter] = useState<RailFilter>("attention");
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const repos = useMemo(() => data?.repos ?? [], [data]);
  useEffect(() => {
    if (!data) return;
    try {
      window.localStorage.setItem(OVERVIEW_CACHE_KEY, JSON.stringify(data));
    } catch {
      // private mode / quota — the live fetch still works
    }
  }, [data]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return repos.filter(
      (repo) => matchesFilter(repo, filter) && (!needle || repo.name.toLowerCase().includes(needle)),
    );
  }, [repos, filter, query]);

  const selected = repos.find((repo) => repo.name === selectedName) ?? null;
  // Keep a valid selection without fighting the user: only auto-pick when the
  // stored repo is gone (deleted/renamed) or nothing was ever selected.
  useEffect(() => {
    if (selected || visible.length === 0) return;
    setSelectedName(visible[0]!.name);
  }, [selected, visible, setSelectedName]);

  async function refreshNow() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch("/api/git/overview?refresh=1");
      if (res.ok) await mutate((await res.json()) as RepoGitOverviewPayload, { revalidate: false });
    } catch {
      // Leave the last snapshot in place; the rail's age label says how old it is.
    } finally {
      setRefreshing(false);
    }
  }

  const attentionCount = filterCount(repos, "attention");

  if (error && !data) {
    return (
      <div className="git-hub git-hub-loading">
        <FetchError message={error.message} onRetry={() => void mutate()} />
      </div>
    );
  }
  if (isLoading && !data) {
    return (
      <div className="git-hub git-hub-loading">
        <SkeletonRows count={8} />
      </div>
    );
  }

  return (
    <div className="git-hub">
      <aside className="git-hub-rail" aria-label="Repositories">
        <div className="git-hub-rail-head">
          <label className="git-hub-search">
            <Search size={13} aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Filter ${repos.length} repo${repos.length === 1 ? "" : "s"}…`}
              aria-label="Filter repositories"
              spellCheck={false}
            />
          </label>
          <button
            type="button"
            className="btn btn-ghost git-hub-refresh"
            onClick={() => void refreshNow()}
            disabled={refreshing}
            title="Rescan every repository"
            aria-label="Rescan repositories"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : undefined} aria-hidden />
          </button>
        </div>

        <div className="git-hub-filters" role="group" aria-label="Filter repositories by git state">
          {FILTERS.map((entry) => {
            const count = filterCount(repos, entry.id);
            return (
              <button
                key={entry.id}
                type="button"
                className="git-hub-filter"
                data-active={filter === entry.id || undefined}
                onClick={() => setFilter(entry.id)}
                aria-pressed={filter === entry.id}
              >
                {entry.label}
                <span className="git-hub-filter-count">{count}</span>
              </button>
            );
          })}
        </div>

        <ul className="git-hub-list">
          {visible.map((repo) => (
            <li key={repo.name}>
              <button
                type="button"
                className="git-hub-row"
                data-active={repo.name === selected?.name || undefined}
                onClick={() => setSelectedName(repo.name)}
                title={repo.path}
              >
                <span className="git-hub-row-main">
                  <span className="git-hub-row-name">{repo.name}</span>
                  <span className="git-hub-row-branch">
                    <GitBranch size={10} aria-hidden />
                    {repo.branch ?? "detached"}
                    {repo.ahead > 0 ? (
                      <span className="git-hub-pill" data-kind="ahead" title={`${repo.ahead} unpushed`}>
                        <ArrowUp size={9} aria-hidden />
                        {repo.ahead}
                      </span>
                    ) : null}
                    {repo.behind > 0 ? (
                      <span className="git-hub-pill" data-kind="behind" title={`${repo.behind} behind`}>
                        <ArrowDown size={9} aria-hidden />
                        {repo.behind}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="git-hub-row-meta">
                  {repo.error ? (
                    <span className="git-hub-pill" data-kind="conflict" title="git status failed or timed out — state unknown">
                      ?
                    </span>
                  ) : null}
                  {repo.conflictCount > 0 ? (
                    <span className="git-hub-pill" data-kind="conflict" title={`${repo.conflictCount} conflicted`}>
                      <AlertTriangle size={9} aria-hidden />
                      {repo.conflictCount}
                    </span>
                  ) : null}
                  {repo.dirtyCount > 0 ? (
                    <span className="git-hub-pill" data-kind="dirty" title={`${repo.dirtyCount} changed`}>
                      {repo.dirtyCount}
                    </span>
                  ) : null}
                  <span className="git-hub-row-age">{relativeAge(repo.lastActivityMs)}</span>
                </span>
              </button>
            </li>
          ))}
          {visible.length === 0 ? (
            <li className="git-hub-list-empty">
              {repos.length === 0
                ? "No repositories in the scan folder."
                : "Nothing matches this filter."}
            </li>
          ) : null}
        </ul>

        <footer className="git-hub-rail-foot">
          {attentionCount > 0
            ? `${attentionCount} repo${attentionCount === 1 ? "" : "s"} need attention`
            : "Everything is pushed and clean"}
          {data ? <time dateTime={data.scannedAt}> · scanned {relativeAge(Date.parse(data.scannedAt)) === "now" ? "just now" : `${relativeAge(Date.parse(data.scannedAt))} ago`}</time> : null}
        </footer>
      </aside>

      <section className="git-hub-main" aria-label="Selected repository">
        {selected ? (
          <RepoGitWorkspace
            key={selected.name}
            repoName={selected.name}
            repoPath={selected.path}
            dirtyCount={selected.dirtyCount}
            unpushedCount={selected.ahead}
            onMutate={() => void mutate()}
            variant="page"
            hideTrigger
          />
        ) : (
          <div className="git-hub-main-empty">
            <EmptyState
              icon={<GitBranch size={32} />}
              title="Pick a repository"
              subtitle="The rail lists every local clone. Select one to open its git workspace."
            />
          </div>
        )}
      </section>
    </div>
  );
}
