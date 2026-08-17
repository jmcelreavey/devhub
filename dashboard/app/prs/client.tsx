"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { GitPullRequest, RefreshCw } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import type { GithubPrsApiPayload, GithubPrRow, RecentlyReviewedPr } from "@/lib/github/prs";
import { useMarkPrsSeen } from "@/lib/hooks/use-sidebar-counts";
import { parseGithubPrUrl } from "@/lib/entity-links/parse-pr";
import { PrRow } from "@/components/PrRow";
import { FetchError, EmptyState, SkeletonRows } from "@/components";
import { BootScreen, useBootGate } from "@/components/today/TodayBootScreen";

type PrTab = "authored" | "reviews" | "recent";

const EMPTY_PR_ROWS: GithubPrRow[] = [];
const EMPTY_RECENTLY_REVIEWED: RecentlyReviewedPr[] = [];

function PrCard({ row, mode }: { row: GithubPrRow; mode: "authored" | "reviews" }) {
  return <PrRow row={row} kind={mode} density="comfortable" />;
}

function RecentlyReviewedCard({ row }: { row: RecentlyReviewedPr }) {
  return <PrRow row={row} kind="reviewed" density="comfortable" />;
}

export default function PrsPage() {
  const [prTab, setPrTab] = useState<PrTab>("authored");
  const [manualUrl, setManualUrl] = useState("");
  const [manualPr, setManualPr] = useState<GithubPrRow | null>(null);
  const [manualError, setManualError] = useState("");
  const { data, error, isLoading, mutate, isValidating } = useLive<GithubPrsApiPayload>("/api/github/prs");
  const boot = useBootGate(data !== undefined || !!error);

  const authored = data?.authored ?? EMPTY_PR_ROWS;
  const reviews = data?.reviews ?? EMPTY_PR_ROWS;
  const recentlyReviewed = data?.recentlyReviewed ?? EMPTY_RECENTLY_REVIEWED;
  useMarkPrsSeen();
  const activePrs = prTab === "authored" ? authored : prTab === "reviews" ? reviews : recentlyReviewed;

  const addManualPr = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseGithubPrUrl(manualUrl.trim());
    if (!parsed) {
      setManualPr(null);
      setManualError("Enter a GitHub pull request URL.");
      return;
    }

    const existing = [...authored, ...reviews, ...recentlyReviewed].find(
      (row) => row.repo === parsed.repo && row.number === parsed.number,
    );
    setManualPr(
      existing ?? {
        repo: parsed.repo,
        number: parsed.number,
        title: `${parsed.repo}#${parsed.number}`,
        url: `https://github.com/${parsed.repo}/pull/${parsed.number}`,
      },
    );
    setManualError("");
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

      <div className="mb-4 space-y-2">
        <form className="card flex flex-col gap-2 sm:flex-row" style={{ padding: 10 }} onSubmit={addManualPr}>
          <label htmlFor="manual-pr-url" className="sr-only">
            GitHub pull request URL
          </label>
          <input
            id="manual-pr-url"
            type="url"
            className="input min-w-0 flex-1 font-mono text-xs"
            placeholder="Paste any GitHub PR URL, including drafts"
            value={manualUrl}
            onChange={(event) => {
              setManualUrl(event.target.value);
              setManualPr(null);
              setManualError("");
            }}
            aria-invalid={manualError ? true : undefined}
            aria-describedby={manualError ? "manual-pr-error" : undefined}
          />
          <button type="submit" className="btn btn-secondary shrink-0 text-xs" disabled={!manualUrl.trim()}>
            Add PR
          </button>
        </form>
        {manualError && (
          <p id="manual-pr-error" className="text-xs text-danger" role="alert">
            {manualError}
          </p>
        )}
        {manualPr && <PrCard row={manualPr} mode="reviews" />}
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
              {t === "authored" ? authored.length : t === "reviews" ? reviews.length : recentlyReviewed.length}
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
            prTab === "authored"
              ? "No open authored PRs."
              : prTab === "reviews"
                ? "No PRs awaiting your review."
                : "No recently reviewed PRs in the last 7 days."
          }
          quips={
            prTab === "reviews"
              ? ["Inbox zero, review edition.", "Nobody needs you. In a good way.", "Clear. Go write some code of your own."]
              : undefined
          }
        />
      )}
    </div>
  );
}
