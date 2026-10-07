"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ScrollText, Settings2 } from "lucide-react";
import { EmptyState, FetchError, SearchInput, SkeletonRows } from "@/components";
import { useLive } from "@/lib/hooks/use-fetch";
import type { ConventionsSummary } from "@/lib/conventions/types";
import { formatRelative } from "@/lib/utils";
import { IDLE_POLL_MS, MINING_POLL_MS, type OverviewPayload } from "./api";
import { ConventionsSettings } from "./ConventionsSettings";
import { RepoConventions } from "./RepoConventions";

interface RepoRow {
  repo: string;
  summary: ConventionsSummary | null;
  mining: boolean;
}

function RepoListItem({ row, selected, onSelect }: { row: RepoRow; selected: boolean; onSelect: () => void }) {
  const [owner, name] = row.repo.split("/");
  const { summary } = row;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className="flex w-full items-center justify-between gap-2 rounded-[var(--radius)] px-3 py-2 text-left hover:bg-[var(--bg-elevated)]"
      style={{ background: selected ? "var(--accent-dim)" : undefined }}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-text">
          <span className="text-text-muted">{owner}/</span>
          {name}
        </span>
        {/* Badges sit under the name, not beside it: beside, they ate the row and truncated the repo to "sig…". */}
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
          <span>
            {row.mining
              ? "Mining…"
              : summary?.lastRunOk === false
                ? "Last run failed"
                : summary?.lastMinedAt
                  ? `Mined ${formatRelative(Date.parse(summary.lastMinedAt))}`
                  : "Not mined yet"}
          </span>
          {summary && summary.active > 0 ? <span className="badge badge-muted">{summary.active} active</span> : null}
        </span>
      </span>
    </button>
  );
}

function ConventionsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showRepos, setShowRepos] = useState(false);

  const { data, error, isLoading, mutate } = useLive<OverviewPayload>("/api/conventions", {
    refreshInterval: (latest) => (latest?.mining?.length ? MINING_POLL_MS : IDLE_POLL_MS),
  });

  const rows = useMemo<RepoRow[]>(() => {
    if (!data) return [];
    const mining = new Set(data.mining);
    const mined: RepoRow[] = data.repos.map((summary) => ({
      repo: summary.repo,
      summary,
      mining: mining.has(summary.repo.toLowerCase()),
    }));
    const untouched: RepoRow[] = data.candidates.map((repo) => ({
      repo,
      summary: null,
      mining: mining.has(repo.toLowerCase()),
    }));
    mined.sort((a, b) => a.repo.localeCompare(b.repo));
    return [...mined, ...untouched];
  }, [data]);

  const needle = query.trim().toLowerCase();
  const visible = needle ? rows.filter((row) => row.repo.toLowerCase().includes(needle)) : rows;
  const minedRows = visible.filter((row) => row.summary !== null);
  const untouchedRows = visible.filter((row) => row.summary === null);
  const selected = params.get("repo") ?? "";

  const select = (repo: string): void => {
    router.replace(`/conventions?repo=${encodeURIComponent(repo)}`, { scroll: false });
    setShowRepos(false);
  };

  return (
    <div className="page-wrapper">
      <header className="page-header items-start mb-6">
        <div className="min-w-0">
          <h1 className="page-title">Conventions</h1>
          <div className="page-subtitle" style={{ color: "var(--text-muted)" }}>
            Repo rules learned and assessed automatically.
            <span className="hidden sm:inline"> Agents use them when reviewing and creating PRs.</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            className="btn btn-ghost text-xs min-h-11 sm:min-h-8"
            aria-expanded={showSettings}
            onClick={() => setShowSettings((v) => !v)}
          >
            <Settings2 size={12} /> Settings
          </button>
        </div>
      </header>

      {showSettings ? <ConventionsSettings onClose={() => setShowSettings(false)} /> : null}

      {error && !data ? <FetchError message={error.message} onRetry={() => void mutate()} /> : null}
      {isLoading && !data ? <SkeletonRows count={5} height={44} variant="list" /> : null}

      {data ? (
        rows.length === 0 ? (
          <EmptyState
            icon={<ScrollText size={16} />}
            title="No repos to learn from yet"
            subtitle="Clone a GitHub repo, or own one from Repos, and it shows up here. Reviews and PR creation start mining on their own."
          />
        ) : (
          <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <nav aria-label="Repos" className="min-w-0">
              {selected ? (
                <div className="lg:hidden">
                  <button
                    type="button"
                    className="btn btn-ghost text-xs min-h-11"
                    aria-expanded={showRepos}
                    aria-controls="conventions-repo-list"
                    onClick={() => setShowRepos((value) => !value)}
                  >
                    {showRepos ? "Hide repo list" : "Change repo"}
                  </button>
                </div>
              ) : null}
              <div id="conventions-repo-list" className={selected && !showRepos ? "hidden lg:block" : ""}>
                <SearchInput value={query} onChange={setQuery} placeholder="Filter repos" wrapperClassName="mb-2" />
                <div className="max-h-40 overflow-y-auto overscroll-contain space-y-0.5 lg:max-h-[calc(100dvh-16rem)]">
                  {minedRows.map((row) => (
                    <RepoListItem key={row.repo} row={row} selected={row.repo.toLowerCase() === selected.toLowerCase()} onSelect={() => select(row.repo)} />
                  ))}
                  {untouchedRows.length > 0 ? (
                    <p className="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-text-muted">Not mined yet</p>
                  ) : null}
                  {untouchedRows.map((row) => (
                    <RepoListItem key={row.repo} row={row} selected={row.repo.toLowerCase() === selected.toLowerCase()} onSelect={() => select(row.repo)} />
                  ))}
                  {visible.length === 0 ? <p className="px-3 py-2 text-xs text-text-muted">{`No repo matches “${query}”.`}</p> : null}
                </div>
              </div>
            </nav>
            <div className="min-w-0">
              {selected ? (
                <RepoConventions key={selected} repo={selected} />
              ) : (
                <EmptyState
                  icon={<ScrollText size={16} />}
                  title="Pick a repo"
                  subtitle="Choose a repo to see its active rules, rejected candidates and the evidence behind each decision."
                />
              )}
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}

export default function ConventionsClient() {
  // useSearchParams needs a boundary so the rest of the page can prerender.
  return (
    <Suspense fallback={<SkeletonRows count={5} height={44} variant="list" />}>
      <ConventionsPage />
    </Suspense>
  );
}
