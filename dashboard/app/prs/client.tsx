"use client";

import { useState } from "react";
import { CircleCheck, ExternalLink, GitPullRequest, MessageSquare, RefreshCw } from "lucide-react";
import { useLive } from "@/lib/use-fetch";
import type { GithubPrsApiPayload, GithubPrRow, RecentlyReviewedPr } from "@/lib/github-prs";
import { useMarkPrsSeen } from "@/lib/use-sidebar-counts";
import { buildSlackMessage, copyWithToast } from "@/lib/pr-slack";
import { useToast } from "@/lib/use-toast";
import { FetchError, EmptyState, SkeletonRows } from "@/components";

type PrTab = "authored" | "reviews" | "recent";

const EMPTY_PR_ROWS: GithubPrRow[] = [];
const EMPTY_RECENTLY_REVIEWED: RecentlyReviewedPr[] = [];

function PrCard({ row, mode }: { row: GithubPrRow; mode: "authored" | "reviews" }) {
  const toast = useToast();

  return (
    <div className="card flex items-center gap-3" style={{ padding: "10px 14px" }}>
      <GitPullRequest size={16} style={{ color: "var(--accent)", flexShrink: 0 }} aria-hidden />
      <a
        href={row.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-w-0 flex-1 flex-col gap-0.5 no-underline"
        style={{ color: "var(--text)" }}
      >
        <span className="text-sm font-medium leading-snug break-words">{row.title}</span>
        <span className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
          {row.repo}#{row.number}
        </span>
      </a>
      {mode === "authored" && (
        <button
          type="button"
          onClick={copyWithToast(buildSlackMessage(row, "awaiting"), "Slack message", toast)}
          title="Copy Slack review message"
          className="shrink-0 rounded p-1 transition-colors hover:bg-[var(--bg-muted)]"
          style={{ color: "var(--text-subtle)" }}
          aria-label="Copy Slack review message"
        >
          <MessageSquare size={13} aria-hidden />
          <span>Copy</span>
        </button>
      )}
      <a
        href={row.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "var(--text-subtle)", flexShrink: 0 }}
        aria-label="Open on GitHub"
      >
        <ExternalLink size={14} aria-hidden />
      </a>
    </div>
  );
}

function RecentlyReviewedCard({ row }: { row: RecentlyReviewedPr }) {
  const toast = useToast();

  return (
    <div className="card flex items-center gap-3" style={{ padding: "10px 14px" }}>
      <GitPullRequest size={16} style={{ color: "var(--accent)", flexShrink: 0 }} aria-hidden />
      <a
        href={row.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-w-0 flex-1 flex-col gap-0.5 no-underline"
        style={{ color: "var(--text)" }}
      >
        <span className="text-sm font-medium leading-snug break-words">{row.title}</span>
        <span className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
          {row.repo}#{row.number}
        </span>
      </a>
      <button
        type="button"
        onClick={copyWithToast(buildSlackMessage(row, "reviewed-approved"), "Slack message", toast)}
        title="reviewed — approved"
        className="shrink-0 rounded p-1 transition-colors hover:bg-[var(--bg-muted)]"
        style={{ color: "var(--success)" }}
        aria-label="Copy reviewed approved message"
      >
        <CircleCheck size={13} aria-hidden />
      </button>
      <button
        type="button"
        onClick={copyWithToast(buildSlackMessage(row, "reviewed"), "Slack message", toast)}
        title="reviewed"
        className="shrink-0 rounded p-1 transition-colors hover:bg-[var(--bg-muted)]"
        style={{ color: "var(--text-subtle)" }}
        aria-label="Copy reviewed message"
      >
        <MessageSquare size={13} aria-hidden />
      </button>
      <a
        href={row.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "var(--text-subtle)", flexShrink: 0 }}
        aria-label="Open on GitHub"
      >
        <ExternalLink size={14} aria-hidden />
      </a>
    </div>
  );
}

export default function PrsPage() {
  const [prTab, setPrTab] = useState<PrTab>("authored");
  const { data, error, isLoading, mutate, isValidating } = useLive<GithubPrsApiPayload>("/api/github/prs");

  const authored = data?.authored ?? EMPTY_PR_ROWS;
  const reviews = data?.reviews ?? EMPTY_PR_ROWS;
  const recentlyReviewed = data?.recentlyReviewed ?? EMPTY_RECENTLY_REVIEWED;
  useMarkPrsSeen();
  const activePrs = prTab === "authored" ? authored : prTab === "reviews" ? reviews : recentlyReviewed;

  if (!data?.configured && !isLoading && !error) {
    return (
      <div className="page-wrapper">
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

      {isLoading && !data && <SkeletonRows count={3} height={60} />}

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
        />
      )}
    </div>
  );
}
