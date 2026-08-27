"use client";

import { useState, type AriaRole, type ReactNode } from "react";
import Link from "next/link";
import { GitPullRequest } from "lucide-react";
import { useLive } from "@/lib/hooks/use-fetch";
import type { GithubPrsApiPayload, GithubPrRow } from "@/lib/github/prs";
import { HUB_STRIP_ICON_PX, hubStripSetupLinkClassName, hubStripSetupLinkStyle } from "@/lib/hub-strip";
import { HubSignalStrip, HubStripHeading, hubStripInlineCodeClassName } from "@/components/shell/HubSignalStrip";
import { TodayCollapseButton } from "@/components/today/TodayCollapseButton";
import { PrRow, type PrRowKind } from "@/components/PrRow";
import { SectionMenuHint } from "@/components/shell/ContextMenu";
import { ConditionalList } from "@/components/ui/EmptyStateRow";
import { useGridSize } from "@/lib/hooks/use-grid-size";

const EMPTY_PR_ROWS: GithubPrRow[] = [];

type PrSection = "authored" | "reviews";

function PrRowLink({ row, kind }: { row: GithubPrRow; kind: PrRowKind }) {
  return (
    <li className="min-w-0">
      <PrRow row={row} kind={kind} density="compact" />
    </li>
  );
}

function SubList({ title, rows, kind }: { title: string; rows: GithubPrRow[]; kind: PrRowKind }) {
  return (
    <ConditionalList
      items={rows}
      renderList={(items) => (
        <div className="min-w-0 space-y-1">
          <h3 className="flex items-baseline justify-between gap-2 text-[11px] font-semibold tracking-tight text-text-muted">
            <span>{title}</span>
            <SectionMenuHint />
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

function SectionToggle({
  authoredCount,
  reviewCount,
  active,
  onSelect,
}: {
  authoredCount: number;
  reviewCount: number;
  active: PrSection;
  onSelect: (section: PrSection) => void;
}) {
  return (
    <div className="flex gap-3 text-[12px]">
      {authoredCount > 0 ? (
        <button
          type="button"
          className="today-grid-drag-cancel bg-transparent p-0"
          aria-pressed={active === "authored"}
          onClick={() => onSelect("authored")}
          style={{
            color: active === "authored" ? "var(--text)" : "var(--text-subtle)",
            fontWeight: active === "authored" ? 600 : 400,
          }}
        >
          <span className="tabular-nums">{authoredCount}</span> mine
        </button>
      ) : null}
      {reviewCount > 0 ? (
        <button
          type="button"
          className="today-grid-drag-cancel bg-transparent p-0"
          aria-pressed={active === "reviews"}
          onClick={() => onSelect("reviews")}
          style={{
            color: active === "reviews" ? "var(--text)" : "var(--text-subtle)",
            fontWeight: active === "reviews" ? 600 : 400,
          }}
        >
          <span className="tabular-nums">{reviewCount}</span> review
        </button>
      ) : null}
    </div>
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
  if (authored.length === 0 && reviews.length === 0) {
    return <span>No open PRs</span>;
  }
  const total = authored.length + reviews.length;
  return (
    <span>
      {total} open ({authored.length} mine · {reviews.length} review)
    </span>
  );
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
            <Link href="/prs" className="text-xs today-grid-drag-cancel text-accent">
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
          <Link href="/prs" className="text-xs today-grid-drag-cancel text-accent">
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
  const [section, setSection] = useState<PrSection>("reviews");
  const authored = data?.authored ?? EMPTY_PR_ROWS;
  const reviews = data?.reviews ?? EMPTY_PR_ROWS;
  const active: PrSection =
    section === "reviews" && reviews.length === 0 && authored.length > 0
      ? "authored"
      : section === "authored" && authored.length === 0 && reviews.length > 0
        ? "reviews"
        : section;
  const activeRows = active === "reviews" ? reviews : authored;
  const activeKind: PrRowKind = active === "reviews" ? "reviews" : "authored";

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
        <div className="min-w-0 py-2 text-xs text-danger" role="alert">
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

  if (authored.length === 0 && reviews.length === 0) {
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
    <div className="space-y-1.5">
      <SectionToggle
        authoredCount={authored.length}
        reviewCount={reviews.length}
        active={active}
        onSelect={setSection}
      />
      {activeRows[0] ? <PrRow row={activeRows[0]} kind={activeKind} density="compact" /> : null}
    </div>
  );

  const compactColumn = (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <SectionToggle
        authoredCount={authored.length}
        reviewCount={reviews.length}
        active={active}
        onSelect={setSection}
      />
      <ul className="m-0 min-h-0 list-none space-y-0.5 overflow-auto p-0">
        {activeRows.map((r) => (
          <PrRowLink key={`${r.repo}-${r.number}`} row={r} kind={activeKind} />
        ))}
      </ul>
    </div>
  );

  const lists = gridSize === "1x1"
    ? compact1x1
    : gridSize === "2x1"
    ? compactColumn
    : (
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
      <SubList title="Mine (open)" rows={authored} kind="authored" />
      <SubList title="Review requested" rows={reviews} kind="reviews" />
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
