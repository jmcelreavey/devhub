"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { GitPullRequest, RefreshCw, X } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import type { GithubPrsApiPayload, GithubPrRow, RecentlyReviewedPr } from "@/lib/github/prs";
import { filterPrRows, type PrSearchRow } from "@/lib/github/pr-search";
import { useGithubPrSearch } from "@/lib/hooks/use-github-pr-search";
import { useMarkPrsSeen } from "@/lib/hooks/use-sidebar-counts";
import { parseGithubPrRef } from "@/lib/entity-links/parse-pr";
import { PrRow } from "@/components/PrRow";
import { FetchError, EmptyState, InlineSearch, SkeletonRows } from "@/components";
import { BootScreen, useBootGate } from "@/components/today/TodayBootScreen";

type PrTab = "authored" | "reviews" | "recent";

const EMPTY_PR_ROWS: GithubPrRow[] = [];
const EMPTY_RECENTLY_REVIEWED: RecentlyReviewedPr[] = [];
/** Keep the GitHub-wide fallback a hint, not a second inbox. */
const MAX_REMOTE_RESULTS = 10;

function PrCard({ row, mode }: { row: GithubPrRow; mode: "authored" | "reviews" }) {
  return <PrRow row={row} kind={mode} density="comfortable" />;
}

function RecentlyReviewedCard({ row }: { row: RecentlyReviewedPr }) {
  return <PrRow row={row} kind="reviewed" density="comfortable" />;
}

function StateBadge({ state }: { state: PrSearchRow["prState"] }) {
  if (state === "open") return null;
  return (
    <span className="badge badge-muted shrink-0" style={{ fontSize: 11, textTransform: "capitalize" }}>
      {state}
    </span>
  );
}

export default function PrsPage() {
  const [prTab, setPrTab] = useState<PrTab>("authored");
  const [query, setQuery] = useState("");
  const [pinned, setPinned] = useState<GithubPrRow[]>([]);
  const { data, error, isLoading, mutate, isValidating } = useLive<GithubPrsApiPayload>("/api/github/prs");
  const boot = useBootGate(data !== undefined || !!error);

  const authored = data?.authored ?? EMPTY_PR_ROWS;
  const reviews = data?.reviews ?? EMPTY_PR_ROWS;
  const recentlyReviewed = data?.recentlyReviewed ?? EMPTY_RECENTLY_REVIEWED;
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
  const filteredRecent = useMemo(
    () => (isFiltering ? filterPrRows(recentlyReviewed, trimmed) : recentlyReviewed),
    [recentlyReviewed, trimmed, isFiltering],
  );

  const localMatchCount =
    filteredAuthored.length + filteredReviews.length + filteredRecent.length;

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
    prTab === "authored" ? filteredAuthored : prTab === "reviews" ? filteredReviews : filteredRecent;

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

  if (!data?.configured && !isLoading && !error) {
    return (
      <div className="page-wrapper">
        <BootScreen state={boot} />
        <div className="page-header">
          <div className="page-title">Pull Requests</div>
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
        <div className="page-title">Pull Requests</div>
        <div className="flex items-center gap-2">
          <span className="badge badge-muted">{authored.length + reviews.length}</span>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: "4px 10px" }}
            onClick={() => mutate()}
            disabled={isValidating}
            aria-label="Refresh PRs"
          >
            <RefreshCw size={12} className={isValidating ? "animate-spin" : ""} aria-hidden />
          </button>
        </div>
      </div>

      {error && <FetchError message="Couldn't reach GitHub." onRetry={() => mutate()} />}

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

      <div className="flex gap-1 mb-4" style={{ borderBottom: "1px solid var(--border-muted)" }}>
        {(["authored", "reviews", "recent"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setPrTab(t)}
            className="px-3 py-2 text-xs font-medium transition-colors"
            style={{
              color: prTab === t ? "var(--text)" : "var(--text-muted)",
              borderBottom: prTab === t ? "2px solid var(--accent)" : "2px solid transparent",
              background: "none",
              cursor: "pointer",
              marginBottom: "-1px",
            }}
            aria-pressed={prTab === t}
          >
            {t === "authored" ? "Mine" : t === "reviews" ? "Review requested" : "Recently reviewed"}
            <span className="ml-1 badge badge-muted" style={{ fontSize: 12 }}>
              {t === "authored"
                ? filteredAuthored.length
                : t === "reviews"
                  ? filteredReviews.length
                  : filteredRecent.length}
            </span>
          </button>
        ))}
      </div>

      {isLoading && !data && <SkeletonRows count={5} height={40} variant="list" />}

      <div className="space-y-2">
        {prTab === "recent"
          ? (activePrs as RecentlyReviewedPr[]).map((row) => (
              <RecentlyReviewedCard key={`${row.repo}-${row.number}`} row={row} />
            ))
          : activePrs.map((row) => (
              <PrCard key={`${row.repo}-${row.number}`} row={row} mode={prTab as "authored" | "reviews"} />
            ))}
      </div>

      {!isLoading && !error && activePrs.length === 0 && data?.configured && (
        <EmptyState
          title={
            isFiltering
              ? `No ${prTab === "authored" ? "authored" : prTab === "reviews" ? "review-requested" : "recently reviewed"} PRs match “${trimmed}”.`
              : prTab === "authored"
                ? "No open authored PRs."
                : prTab === "reviews"
                  ? "No PRs awaiting your review."
                  : "No recently reviewed PRs in the last 7 days."
          }
          quips={
            !isFiltering && prTab === "reviews"
              ? ["Inbox zero, review edition.", "Nobody needs you. In a good way.", "Clear. Go write some code of your own."]
              : undefined
          }
        />
      )}
      {/* GitHub-wide fallback: PRs outside your authored/review buckets. */}
      {isFiltering && (remoteResults.length > 0 || remote.loading) && (
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
                    <StateBadge state={row.prState} />
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
