"use client";

import type { AriaRole, ReactNode } from "react";
import Link from "next/link";
import { GitPullRequest } from "lucide-react";
import { useLive } from "@/lib/use-fetch";
import type { GithubPrsApiPayload, GithubPrRow, RecentlyReviewedPr } from "@/lib/github-prs";
import { HUB_STRIP_ICON_PX, hubStripSetupLinkClassName, hubStripSetupLinkStyle } from "@/lib/hub-strip";
import { HubSignalStrip, HubStripHeading, hubStripInlineCodeClassName } from "@/components/HubSignalStrip";
import { TodayCollapseButton } from "@/components/TodayCollapseButton";
import { PrRowActions, type PrRowKind } from "@/components/PrRowActions";
import { ConditionalList } from "@/components/ui/EmptyStateRow";
import { useGridSize } from "@/lib/use-grid-size";

const EMPTY_PR_ROWS: GithubPrRow[] = [];
const EMPTY_RECENTLY_REVIEWED: RecentlyReviewedPr[] = [];

function PrRowLink({ row, kind }: { row: GithubPrRow; kind?: PrRowKind }) {
  return (
    <li className="min-w-0">
      <div className="flex items-center gap-1 rounded px-2 py-1.5 transition-colors hover:bg-[var(--bg-muted)]">
        <a
          href={row.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 no-underline"
          style={{ color: "var(--text)" }}
        >
          <span className="break-words text-sm font-medium leading-snug">{row.title}</span>
          <span className="font-mono text-[11px] leading-tight" style={{ color: "var(--text-muted)" }}>
            {row.repo}#{row.number}
          </span>
        </a>
        {kind && <PrRowActions row={row} kind={kind} size="sm" />}
      </div>
    </li>
  );
}

function SubList({ title, rows, kind }: { title: string; rows: GithubPrRow[]; kind?: PrRowKind }) {
  return (
    <ConditionalList
      items={rows}
      renderList={(items) => (
        <div className="min-w-0 space-y-1">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            {title}
          </h3>
          <ul className="m-0 list-none space-y-0.5 p-0">
            {items.map((r) => (
              <PrRowLink key={`${r.repo}-${r.number}`} row={r} kind={kind} />
            ))}
          </ul>
        </div>
      )}
    />
  );
}

export function GithubPrsCollapsedSummary() {
  const { data, error, isLoading } = useLive<GithubPrsApiPayload>("/api/github/prs");

  if (isLoading && !data) {
    return <span className="inline-block h-3 w-28 rounded skeleton" aria-hidden />;
  }
  if (error) {
    return <span>Couldn&apos;t load</span>;
  }
  if (!data?.configured) {
    return <span>Run gh auth login</span>;
  }
  const authored = data.authored ?? [];
  const reviews = data.reviews ?? [];
  const recentlyReviewed = data.recentlyReviewed ?? [];
  if (authored.length === 0 && reviews.length === 0 && recentlyReviewed.length === 0) {
    return <span>No open PRs</span>;
  }
  const total = authored.length + reviews.length;
  if (total > 0 && recentlyReviewed.length > 0) {
    return (
      <span>
        {total} open · {recentlyReviewed.length} reviewed
      </span>
    );
  }
  if (recentlyReviewed.length > 0) {
    return <span>{recentlyReviewed.length} recently reviewed</span>;
  }
  if (authored.length > 0 && reviews.length > 0) {
    return (
      <span>
        {total} open ({authored.length} mine · {reviews.length} review)
      </span>
    );
  }
  if (authored.length > 0) {
    return <span>{authored.length} open (mine)</span>;
  }
  return <span>{reviews.length} review requested</span>;
}

interface GithubPrsPanelProps {
  className?: string;
  variant?: "strip" | "embedded";
  collapsed?: boolean;
  collapsedSummary?: ReactNode;
  onToggle?: () => void;
}

interface GithubPrsStripShellProps {
  ariaLabel?: string;
  children: ReactNode;
  className: string;
  collapsed: boolean;
  collapsedSummary?: ReactNode;
  onToggle?: () => void;
  role?: AriaRole;
  tone?: "default" | "danger";
}

function GithubPrsStripShell({
  ariaLabel,
  children,
  className,
  collapsed,
  collapsedSummary,
  onToggle,
  role,
  tone,
}: GithubPrsStripShellProps) {
  if (onToggle) {
    return (
      <div
        className="card"
        data-collapsed={collapsed ? "true" : undefined}
        role={role}
        aria-label={ariaLabel}
        style={tone === "danger" ? { color: "var(--danger)" } : undefined}
      >
        <div className="card-header today-grid-drag-handle">
          <span className="flex min-w-0 items-center gap-1.5">
            <GitPullRequest size={12} aria-hidden /> GitHub PRs
          </span>
          <span className="flex min-w-0 items-center gap-2">
            {collapsed && collapsedSummary ? <span className="today-collapsed-summary">{collapsedSummary}</span> : null}
            <Link href="/prs" className="text-xs today-grid-drag-cancel" style={{ color: "var(--accent)" }}>
              View all →
            </Link>
            <TodayCollapseButton collapsed={collapsed} label="GitHub PRs" onToggle={onToggle} />
          </span>
        </div>
        {!collapsed ? (
          <div className="card-body today-card-body-compact">
            {children}
          </div>
        ) : null}
      </div>
    );
  }

  const shellClassName = ["today-signal-card", className].filter(Boolean).join(" ");

  return (
    <HubSignalStrip
      className={shellClassName}
      tone={tone}
      role={role}
      aria-label={ariaLabel}
      data-collapsed={collapsed ? "true" : undefined}
    >
      <div className="today-signal-head">
        <HubStripHeading className="mb-0" icon={<GitPullRequest size={HUB_STRIP_ICON_PX} aria-hidden />}>
          GitHub PRs
        </HubStripHeading>
        <span className="flex min-w-0 items-center gap-2">
          {collapsed && collapsedSummary ? <span className="today-collapsed-summary">{collapsedSummary}</span> : null}
          <Link href="/prs" className="text-xs today-grid-drag-cancel" style={{ color: "var(--accent)" }}>
            View all →
          </Link>
        </span>
      </div>
      {!collapsed ? <div className="today-signal-body">{children}</div> : null}
    </HubSignalStrip>
  );
}

export function GithubPrsPanel({
  className = "mb-3",
  variant = "strip",
  collapsed = false,
  collapsedSummary,
  onToggle,
}: GithubPrsPanelProps) {
  const { data, error, isLoading } = useLive<GithubPrsApiPayload>("/api/github/prs");
  const gridSize = useGridSize("github");
  const authored = data?.authored ?? EMPTY_PR_ROWS;
  const reviews = data?.reviews ?? EMPTY_PR_ROWS;
  const recentlyReviewed = data?.recentlyReviewed ?? EMPTY_RECENTLY_REVIEWED;

  if (isLoading && !data) {
    const skeleton = <div className="skeleton" style={{ height: 14, width: "40%" }} />;
    if (variant === "embedded") {
      return <div className="min-w-0 py-2">{skeleton}</div>;
    }
    return (
      <GithubPrsStripShell
        className={className}
        collapsed={collapsed}
        collapsedSummary={collapsedSummary}
        onToggle={onToggle}
        ariaLabel="GitHub pull requests"
      >
        {skeleton}
      </GithubPrsStripShell>
    );
  }

  if (error) {
    const body = <>Couldn&apos;t load GitHub PRs. {error instanceof Error ? error.message : String(error)}</>;
    if (variant === "embedded") {
      return (
        <div className="min-w-0 py-2 text-xs" style={{ color: "var(--danger)" }} role="alert">
          {body}
        </div>
      );
    }
    return (
      <GithubPrsStripShell
        className={className}
        collapsed={collapsed}
        collapsedSummary={collapsedSummary}
        onToggle={onToggle}
        role="alert"
        tone="danger"
      >
        {body}
      </GithubPrsStripShell>
    );
  }

  if (!data?.configured) {
    const inner = (
      <p className="mb-0 leading-snug">
        Run <code className={hubStripInlineCodeClassName}>gh auth login</code> on this machine, then refresh.{" "}
        <Link href="/setup" className={hubStripSetupLinkClassName} style={hubStripSetupLinkStyle}>
          Setup
        </Link>
      </p>
    );
    if (variant === "embedded") {
      return <div className="min-w-0 py-1 text-xs">{inner}</div>;
    }
    return (
      <GithubPrsStripShell
        className={className}
        collapsed={collapsed}
        collapsedSummary={collapsedSummary}
        onToggle={onToggle}
        ariaLabel="GitHub pull requests"
      >
        {inner}
      </GithubPrsStripShell>
    );
  }

  if (authored.length === 0 && reviews.length === 0 && recentlyReviewed.length === 0) {
    const inner = (
      <p className="mb-0 leading-snug">
        No open PRs from GitHub search. Authored PRs and review requests from archived repositories are hidden.
      </p>
    );
    if (variant === "embedded") {
      return <div className="min-w-0 py-1 text-xs">{inner}</div>;
    }
    return (
      <GithubPrsStripShell
        className={className}
        collapsed={collapsed}
        collapsedSummary={collapsedSummary}
        onToggle={onToggle}
        ariaLabel="GitHub pull requests"
      >
        {inner}
      </GithubPrsStripShell>
    );
  }

  const compact1x1 = (
    <div className="px-3 py-2.5 space-y-1.5">
      <div className="flex gap-3 text-[12px]" style={{ color: "var(--text-subtle)" }}>
        {authored.length > 0 && <span><span style={{ color: "var(--text)", fontWeight: 600 }}>{authored.length}</span> mine</span>}
        {reviews.length > 0 && <span><span style={{ color: "var(--text)", fontWeight: 600 }}>{reviews.length}</span> review</span>}
        {recentlyReviewed.length > 0 && <span><span style={{ color: "var(--text-muted)" }}>{recentlyReviewed.length}</span> reviewed</span>}
      </div>
      {authored[0] && (
        <a href={authored[0].url} target="_blank" rel="noopener noreferrer" className="block truncate text-[12px] no-underline hover:underline" style={{ color: "var(--text)" }}>
          {authored[0].title}
        </a>
      )}
    </div>
  );

  const compact2x1 = (
    <div className="divide-y" style={{ borderColor: "var(--border-muted)" }}>
      {authored.length > 0 && (
        <div className="px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: "var(--text-muted)", fontWeight: 600 }}>Mine</div>
          {authored.slice(0, 3).map((r) => (
            <a key={r.url} href={r.url} target="_blank" rel="noopener noreferrer" className="block truncate text-[12px] py-0.5 no-underline hover:underline" style={{ color: "var(--text)" }}>
              {r.title}
            </a>
          ))}
          {authored.length > 3 && <span className="text-[11px]" style={{ color: "var(--text-subtle)" }}>+{authored.length - 3} more</span>}
        </div>
      )}
      {reviews.length > 0 && (
        <div className="px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: "var(--text-muted)", fontWeight: 600 }}>Review</div>
          {reviews.slice(0, 3).map((r) => (
            <a key={r.url} href={r.url} target="_blank" rel="noopener noreferrer" className="block truncate text-[12px] py-0.5 no-underline hover:underline" style={{ color: "var(--text)" }}>
              {r.title}
            </a>
          ))}
          {reviews.length > 3 && <span className="text-[11px]" style={{ color: "var(--text-subtle)" }}>+{reviews.length - 3} more</span>}
        </div>
      )}
    </div>
  );

  const lists = gridSize === "1x1"
    ? compact1x1
    : gridSize === "2x1"
    ? compact2x1
    : (
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
      <SubList title="Mine (open)" rows={authored} kind="authored" />
      <SubList title="Review requested" rows={reviews} kind="reviews" />
      <SubList title="Recently reviewed" rows={recentlyReviewed} kind="reviewed" />
    </div>
  );

  if (variant === "embedded") {
    return <div className="min-w-0 pt-1">{lists}</div>;
  }

  return (
    <GithubPrsStripShell
      className={className}
      collapsed={collapsed}
      collapsedSummary={collapsedSummary}
      onToggle={onToggle}
      ariaLabel="Your GitHub pull requests"
    >
      {lists}
    </GithubPrsStripShell>
  );
}
