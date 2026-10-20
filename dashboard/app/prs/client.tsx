"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { FormEvent } from "react";
import { GitPullRequest, RefreshCw, RotateCcw, X } from "lucide-react";
import { AutoReviewBar } from "./AutoReviewBar";
import { useLive } from "@/lib/hooks/use-fetch";
import type { GithubPrsApiPayload, GithubPrRow, RecentlyReviewedPr } from "@/lib/github/prs";
import type { SkippedPrRecord } from "@/lib/github/skipped-prs";
import { mutate as globalMutate } from "swr";
import { filterPrRows, type PrSearchRow } from "@/lib/github/pr-search";
import { useGithubPrSearch } from "@/lib/hooks/use-github-pr-search";
import { useMarkPrsSeen } from "@/lib/hooks/use-sidebar-counts";
import { parseGithubPrRef } from "@/lib/entity-links/parse-pr";
import { PrRow } from "@/components/PrRow";
import { usePrStatusMenu } from "@/components/github/PrStatusMenu";
import { useToast } from "@/lib/hooks/use-toast";
import { FetchError, EmptyState, InlineSearch, SkeletonRows } from "@/components";
import { BootScreen, useBootGate } from "@/components/today/TodayBootScreen";
import {
  WorktreeCleanupPanel,
  WORKTREE_CLEANUP_KEY,
  WORKTREE_CLEANUP_OPTS,
} from "@/components/prs/WorktreeCleanupPanel";
import type { WorktreeCleanupResult } from "@/lib/repos/worktree-cleanup";
import { OwnedPrsPanel } from "@/components/prs/OwnedPrsPanel";
import { prTabFromSearch, type PrTab } from "@/lib/github/pr-tabs";
import type { TaskProfileOverview } from "@/lib/tasks/profile-types";
import { actionablePrs, prIdentity } from "@/lib/github/actionable-prs";
import { OWNED_REPOS_SWR_KEY } from "@/lib/ownership/owned-repos-swr";
import type { OwnedReposResponse } from "@/lib/ownership/types";

const EMPTY_PR_ROWS: GithubPrRow[] = [];
const EMPTY_RECENTLY_REVIEWED: RecentlyReviewedPr[] = [];
const EMPTY_SKIPPED: SkippedPrRecord[] = [];
/** Keep the GitHub-wide fallback a hint, not a second inbox. */
const MAX_REMOTE_RESULTS = 10;

function PrCard({ row, mode }: { row: GithubPrRow; mode: "authored" | "reviews" }) {
  return <PrRow row={row} kind={mode} density="comfortable" />;
}

function RecentlyReviewedCard({ row }: { row: RecentlyReviewedPr }) {
  return <PrRow row={row} kind="reviewed" density="comfortable" />;
}

function skippedAsRow(r: SkippedPrRecord): GithubPrRow {
  return { number: r.number, title: r.title, url: r.url, repo: r.repo, updatedAt: r.updatedAt };
}

function StateBadge({ row }: { row: PrSearchRow }) {
  const menu = usePrStatusMenu({
    url: row.url,
    repo: row.repo,
    number: row.number,
    checks: row.checks ?? null,
    checkCounts: row.checkCounts ?? null,
  });
  if (row.prState === "open") return null;
  return (
    <>
      <span
        className="badge badge-muted shrink-0"
        style={{ fontSize: 11, textTransform: "capitalize" }}
        tabIndex={0}
        {...menu.bind}
      >
        {row.prState}
      </span>
      {menu.menuNode}
    </>
  );
}

export default function PrsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const prTab = prTabFromSearch(searchParams.get("tab"));
  const setPrTab = (tab: PrTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`/prs?${params}`, { scroll: false });
  };
  const profile = useLive<TaskProfileOverview>("/api/tasks/profiles");
  const profileId = !profile.error && profile.data ? profile.data.active ?? "legacy" : undefined;
  const urlQuery = searchParams.get("q") ?? "";
  const [search, setSearch] = useState({ urlQuery, query: urlQuery });
  // A pill can navigate to another PR while this page is already mounted.
  if (search.urlQuery !== urlQuery) setSearch({ urlQuery, query: urlQuery });
  const query = search.urlQuery === urlQuery ? search.query : urlQuery;
  const setQuery = (query: string) => setSearch({ urlQuery, query });
  const [pinned, setPinned] = useState<GithubPrRow[]>([]);
  const { data, error, isLoading, mutate, isValidating } = useLive<GithubPrsApiPayload>("/api/github/prs");
  const owned = useLive<OwnedReposResponse>(OWNED_REPOS_SWR_KEY);
  const skippedState = useLive<{ skipped: SkippedPrRecord[] }>("/api/github/prs/skip");
  // Same SWR key as the panel, so the badge and the list share one scan.
  const cleanupState = useLive<WorktreeCleanupResult>(WORKTREE_CLEANUP_KEY, WORKTREE_CLEANUP_OPTS);
  const toast = useToast();
  const boot = useBootGate(data !== undefined || !!error);

  const authored = data?.authored ?? EMPTY_PR_ROWS;
  const reviews = data?.reviews ?? EMPTY_PR_ROWS;
  const recentlyReviewed = data?.recentlyReviewed ?? EMPTY_RECENTLY_REVIEWED;
  const skipped = skippedState.data?.skipped ?? EMPTY_SKIPPED;
  const attention = useMemo(() => actionablePrs(authored, reviews, owned.data?.repos.map((repo) => repo.fullName) ?? []), [authored, reviews, owned.data]);
  const actionCount = attention.mine.length + attention.reviews.length;
  const actionCountKnown = !!data?.configured && !!owned.data && !owned.error && authored.every((pr) => pr.checks !== undefined);
  const authoredIds = useMemo(() => new Set(authored.map(prIdentity)), [authored]);

  const unskip = async (row: SkippedPrRecord) => {
    // Optimistic: drop from the Skipped tab now; the Review-requested refetch
    // takes seconds, so let it settle in the background.
    await skippedState.mutate(
      (cur) => (cur ? { ...cur, skipped: cur.skipped.filter((r) => r.url !== row.url) } : cur),
      { revalidate: false },
    );
    try {
      const res = await fetch(`/api/github/prs/skip?url=${encodeURIComponent(row.url)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      toast.info(`${row.repo}#${row.number} is back in ${row.kind === "authored" ? "Mine" : "Review requested"}.`);
    } catch {
      toast.error("Couldn't unskip PR.");
      await skippedState.mutate();
    }
    void globalMutate("/api/github/prs");
  };
  useMarkPrsSeen();

  const trimmed = query.trim();
  // A pasted PR URL (or `owner/repo#123`) flips the box from filter to add mode.
  const prRef = useMemo(() => (trimmed ? parseGithubPrRef(trimmed) : null), [trimmed]);
  const isAddMode = prRef !== null;
  const isFiltering = trimmed.length > 0 && !isAddMode;

  const filteredAuthored = useMemo(
    () => (isFiltering ? filterPrRows(authored, trimmed) : authored),
    [authored, trimmed, isFiltering],
  );
  const filteredReviews = useMemo(
    () => (isFiltering ? filterPrRows(reviews, trimmed) : reviews),
    [reviews, trimmed, isFiltering],
  );
  const filteredAttention = useMemo(() => filterPrRows([...attention.mine, ...attention.reviews], isFiltering ? trimmed : ""), [attention, trimmed, isFiltering]);
  const filteredRecent = useMemo(
    () => (isFiltering ? filterPrRows(recentlyReviewed, trimmed) : recentlyReviewed),
    [recentlyReviewed, trimmed, isFiltering],
  );
  const skippedRows = useMemo(() => skipped.map(skippedAsRow), [skipped]);
  const filteredSkipped = useMemo(
    () => (isFiltering ? filterPrRows(skippedRows, trimmed) : skippedRows),
    [skippedRows, trimmed, isFiltering],
  );

  const localMatchCount = prTab === "attention" ? filteredAttention.length :
    filteredAuthored.length + filteredReviews.length + filteredRecent.length + filteredSkipped.length;

  // Only trawl GitHub when the query is a phrase, not a URL we're about to pin.
  const remote = useGithubPrSearch(trimmed, isFiltering);
  const knownUrls = useMemo(
    () => new Set([...authored, ...reviews, ...recentlyReviewed, ...pinned].map((r) => r.url)),
    [authored, reviews, recentlyReviewed, pinned],
  );
  const remoteResults = useMemo(
    () => remote.results.filter((r) => !knownUrls.has(r.url)).slice(0, MAX_REMOTE_RESULTS),
    [remote.results, knownUrls],
  );

  const activePrs =
    prTab === "attention"
      ? filteredAttention
      : prTab === "authored"
      ? filteredAuthored
      : prTab === "reviews"
        ? filteredReviews
        : prTab === "recent"
          ? filteredRecent
          : filteredSkipped;

  // A list rather than a ternary per tab: five tabs made the inline chains for
  // label and count unreadable, and the next tab would have been worse.
  const tabs: { id: PrTab; label: string; count?: number }[] = [
    { id: "attention", label: "Mine + Owned" },
    { id: "authored", label: "Mine", count: filteredAuthored.length },
    { id: "owned", label: "Owned" },
    { id: "reviews", label: "Review requested" },
    { id: "recent", label: "Recently reviewed", count: filteredRecent.length },
    { id: "skipped", label: "Skipped", count: filteredSkipped.length },
    { id: "cleanup", label: "Worktrees", count: cleanupState.data?.rows.length ?? 0 },
  ];

  const addPinnedPr = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!prRef) return;
    const url = `https://github.com/${prRef.repo}/pull/${prRef.number}`;
    const existing = [...authored, ...reviews, ...recentlyReviewed].find((row) => row.url === url);
    const row: GithubPrRow = existing ?? {
      repo: prRef.repo,
      number: prRef.number,
      title: `${prRef.repo}#${prRef.number}`,
      url,
    };
    setPinned((prev) => (prev.some((p) => p.url === row.url) ? prev : [row, ...prev]));
    setQuery("");
  };

  const pinRemoteResult = (row: PrSearchRow) => {
    setPinned((prev) => (prev.some((p) => p.url === row.url) ? prev : [row, ...prev]));
  };

  if (!data?.configured && !isLoading && !error && prTab !== "owned" && prTab !== "cleanup") {
    return (
      <div className="page-wrapper">
        <BootScreen state={boot} />
        <div className="page-header">
          <h1 className="page-title">Pull Requests</h1>
        </div>
        <EmptyState
          icon={<GitPullRequest size={28} />}
          title="No GitHub connection."
          subtitle="Authenticate with gh auth login to see PRs."
        />
      </div>
    );
  }

  return (
    <div className="page-wrapper">
      <BootScreen state={boot} />
      <div className="page-header">
        <h1 className="page-title">Pull Requests</h1>
        <div className="flex items-center gap-2">
          <Link className="btn btn-ghost" href="/integrations?action=pr.create#actions">Create or update PR…</Link>
          {actionCountKnown && actionCount > 0 ? <span className="badge badge-muted" aria-label={`${actionCount} pull requests need you`}>{actionCount}</span> : null}
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: "4px 10px" }}
            onClick={() => { void mutate(); void owned.mutate(); }}
            disabled={isValidating}
            aria-label="Refresh PRs"
          >
            <RefreshCw size={12} className={isValidating ? "animate-spin" : ""} aria-hidden />
          </button>
        </div>
      </div>

      {error && !data?.stale && <FetchError message="Couldn't reach GitHub." onRetry={() => mutate()} />}
      {prTab === "attention" && owned.error ? <FetchError message="Couldn't load Owned repositories. Review totals are unavailable." onRetry={() => void owned.mutate()} /> : null}
      {data?.stale && data.warning && (
        <p className="mb-3 text-xs text-warning" role="status">
          {data.warning}
        </p>
      )}

      {/* One box: type to filter, paste a PR URL to pin it. */}
      <div className="mb-4 space-y-2">
        <form className="card" style={{ padding: "8px 10px" }} onSubmit={addPinnedPr}>
          <InlineSearch
            id="pr-search"
            label="Search pull requests or paste a PR URL"
            placeholder="Search by title, repo, author or reviewer — or paste a PR URL"
            value={query}
            onChange={setQuery}
            describedBy="pr-search-hint"
            trailing={
              isAddMode ? (
                <button type="submit" className="btn btn-secondary shrink-0 text-xs">
                  Add PR
                </button>
              ) : null
            }
          />
        </form>

        <p id="pr-search-hint" className="px-1 text-xs text-text-subtle" role="status">
          {isAddMode
            ? `Looks like ${prRef.repo}#${prRef.number} — press Enter to pin it.`
            : isFiltering
              ? `${localMatchCount} of ${authored.length + reviews.length + recentlyReviewed.length} loaded PRs match${
                  remote.loading ? " · searching GitHub…" : ""
                }`
              : "Paste any GitHub PR URL to pin it, including drafts."}
        </p>

        {pinned.length > 0 && (
          <div className="space-y-2">
            {pinned.map((row) => (
              <div key={row.url} className="flex items-start gap-1">
                <div className="min-w-0 flex-1">
                  <PrCard row={row} mode="reviews" />
                </div>
                <button
                  type="button"
                  className="mt-2 rounded p-1 transition-colors hover:bg-[var(--bg-muted)]"
                  onClick={() => setPinned((prev) => prev.filter((p) => p.url !== row.url))}
                  style={{ color: "var(--text-subtle)" }}
                  aria-label={`Unpin ${row.repo}#${row.number}`}
                >
                  <X size={14} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-1" style={{ borderBottom: "1px solid var(--border-muted)" }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setPrTab(tab.id)}
            className="px-3 py-2 text-xs font-medium transition-colors"
            style={{
              color: prTab === tab.id ? "var(--text)" : "var(--text-muted)",
              borderBottom: prTab === tab.id ? "2px solid var(--accent)" : "2px solid transparent",
              background: "none",
              cursor: "pointer",
              marginBottom: "-1px",
            }}
            aria-pressed={prTab === tab.id}
          >
            {tab.label}
            {tab.count !== undefined ? <span className="ml-1 badge badge-muted" style={{ fontSize: 12 }}>
              {tab.count}
            </span> : null}
          </button>
        ))}
      </div>

      {prTab === "reviews" && <AutoReviewBar disabled={reviews.length === 0} />}
      {prTab === "attention" ? <p className="mb-3 text-xs text-text-muted">Your PRs needing action and review requests in repositories you Own.</p> : null}

      {prTab === "cleanup" && <WorktreeCleanupPanel />}
      {prTab === "owned" && (profile.error ? <FetchError message="Couldn't confirm the active profile." onRetry={() => void profile.mutate()} /> : <OwnedPrsPanel key={profileId} profile={profileId} query={isFiltering ? trimmed : ""} />)}

      {((isLoading && !data) || (prTab === "attention" && !owned.data && !owned.error)) && prTab !== "cleanup" && prTab !== "owned" && (
        <SkeletonRows count={5} height={40} variant="list" />
      )}

      <div className="space-y-2">
        {prTab === "recent"
          ? (activePrs as RecentlyReviewedPr[]).map((row) => (
              <RecentlyReviewedCard key={`${row.repo}-${row.number}`} row={row} />
            ))
          : prTab === "skipped"
            ? filteredSkipped.map((row) => {
                const record = skipped.find((r) => r.url === row.url);
                return (
                  <div key={row.url} className="flex items-start gap-1">
                    <div className="min-w-0 flex-1">
                      <PrCard row={row} mode={record?.kind ?? "reviews"} />
                    </div>
                    <button
                      type="button"
                      className="mt-2 rounded p-1 transition-colors hover:bg-[var(--bg-muted)] shrink-0"
                      onClick={() => record && void unskip(record)}
                      style={{ color: "var(--text-subtle)" }}
                      aria-label={`Unskip ${row.repo}#${row.number}`}
                      title={`Show in ${record?.kind === "authored" ? "Mine" : "Review requested"} again`}
                    >
                      <RotateCcw size={14} aria-hidden />
                    </button>
                  </div>
                );
              })
            : prTab === "cleanup" || prTab === "owned"
              ? null
              : activePrs.map((row) => (
                  <PrCard key={`${row.repo}-${row.number}`} row={row} mode={authoredIds.has(prIdentity(row)) ? "authored" : "reviews"} />
                ))}
      </div>

      {prTab !== "cleanup" && prTab !== "owned" && !isLoading && !error && activePrs.length === 0 && data?.configured && (prTab !== "attention" || actionCountKnown) && (
        <EmptyState
          title={
            prTab === "attention"
              ? isFiltering ? `No Mine or Owned action items match “${trimmed}”.` : "Nothing needs you in Mine or Owned."
              : isFiltering
              ? `No ${
                  prTab === "authored"
                    ? "authored"
                    : prTab === "reviews"
                      ? "review-requested"
                      : prTab === "recent"
                        ? "recently reviewed"
                        : "skipped"
                } PRs match “${trimmed}”.`
              : prTab === "authored"
                ? "No open authored PRs."
                : prTab === "reviews"
                  ? "No PRs awaiting your review."
                  : prTab === "recent"
                    ? "No recently reviewed PRs in the last 7 days."
                    : "No skipped PRs. Right-click a PR to skip it."
          }
          quips={
            !isFiltering && prTab === "reviews"
              ? ["Inbox zero, review edition.", "Nobody needs you. In a good way.", "Clear. Go write some code of your own."]
              : undefined
          }
        />
      )}
      {/* GitHub-wide fallback: PRs outside your authored/review buckets. */}
      {prTab !== "cleanup" && prTab !== "owned" && isFiltering && (remoteResults.length > 0 || remote.loading) && (
        <section className="mt-6" aria-label="Elsewhere on GitHub">
          <div className="mb-2 flex items-baseline gap-2 px-1">
            <h2 className="text-xs font-medium text-text-muted">Elsewhere on GitHub</h2>
            {remote.ghQuery ? (
              <code className="text-xs text-text-subtle">{remote.ghQuery}</code>
            ) : null}
          </div>
          {remote.loading && remoteResults.length === 0 ? (
            <SkeletonRows count={3} height={40} variant="list" />
          ) : (
            <div className="space-y-2">
              {remoteResults.map((row) => (
                <div key={row.url} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <PrCard row={row} mode="reviews" />
                  </div>
                  <div className="mt-2 flex shrink-0 items-center gap-1">
                    <StateBadge row={row} />
                    <button
                      type="button"
                      className="btn btn-ghost text-xs"
                      style={{ padding: "2px 8px" }}
                      onClick={() => pinRemoteResult(row)}
                    >
                      Pin
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {remote.error && isFiltering ? (
        <p className="mt-3 px-1 text-xs text-danger" role="alert">
          Couldn&apos;t search GitHub: {remote.error}
        </p>
      ) : null}

    </div>
  );
}
