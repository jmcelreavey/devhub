"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { lookupByEmail } from "@/lib/people/identity";
import { laneColor, type GraphLaneCommit } from "@/lib/repos/git-graph";
import { RowMenuKebab, type RowMenuBind } from "@/components/shell/ContextMenu";
import { CommitAvatar } from "./CommitAvatar";

interface CommitGraphProps {
  commits: GraphLaneCommit[];
  selectedHash?: string | null;
  onSelect?: (hash: string) => void;
  onContextMenu?: (event: MouseEvent<HTMLElement>, commit: GraphLaneCommit) => void;
  onKebabOpen?: (x: number, y: number, commit: GraphLaneCommit) => void;
  rowBind?: (commit: GraphLaneCommit) => RowMenuBind;
  /** Full or short hashes of commits ahead of upstream — lightly marked in the list. */
  unpushedHashes?: Set<string>;
  /** Refs treated as the default branch (e.g. main, origin/main) for chip tone. */
  mainRefNames?: string[];
  /**
   * Author email → the resolved identity for it. Keyed on every address a
   * person commits under, so one human renders as one contributor.
   */
  identityByEmail?: Record<string, { avatarUrl: string | null; displayName: string }>;
  /**
   * Working-tree summary pinned above HEAD as a synthetic row. Null/absent
   * hides the row (clean tree or status not loaded yet).
   */
  wip?: { staged: number; unstaged: number } | null;
  /** Click on the WIP row — the workspace jumps to the Changes tab. */
  onOpenWip?: () => void;
  /**
   * Mouse-down starts dragging this commit (drag onto a branch chip/rail item
   * to merge, rebase or cherry-pick). Mouse-only — touch keeps long-press.
   */
  onRowDragStart?: (event: ReactPointerEvent<HTMLDivElement>, commit: GraphLaneCommit) => void;
  /**
   * Full hashes of local commits that are not on the default branch yet.
   * Rows in this set get a tinted band + edge bar, so "how far ahead is this
   * branch" reads as a contiguous strip from fork point to HEAD.
   */
  aheadOfMain?: Set<string>;
  /** merge-base(HEAD, main) — the row where the ahead band starts. */
  forkBase?: string | null;
  /** Display name for the fork marker chip ("main"). */
  forkLabel?: string | null;
  /** Commits ahead of main — rendered as a ↑N pill on the HEAD row. */
  aheadMain?: number;
}

/** Refs you can drop a commit onto: local branches only. */
export function isBranchDropTarget(ref: string, headBranch: string | null): boolean {
  return !ref.startsWith("tag:") && !ref.startsWith("origin/") && ref !== headBranch;
}

/**
 * `origin/HEAD` and friends are decoration noise — they always shadow the
 * real branch chip on the same commit and double the refs track width for
 * zero information.
 */
function displayRefs(commit: GraphLaneCommit): string[] {
  return commit.refs.filter((r) => !r.endsWith("/HEAD"));
}

const ROW_H = 32;
const LANE_W = 14;
const PAD_X = 10;
const NODE_R = 4;
/** Vertical distance an elbow takes to change lane. Kept under one row so a
 *  branch that lives for a single commit still reads as a corner, not a wedge. */
const ELBOW = ROW_H * 0.8;
/** Rows rendered beyond the visible window, so scroll never shows a blank edge. */
const OVERSCAN = 10;

function isMainRef(ref: string, mainRefNames: string[]): boolean {
  const normalized = ref.replace(/^HEAD -> /, "").trim();
  return mainRefNames.some((name) => normalized === name || normalized.endsWith(`/${name}`));
}

function laneX(lane: number): number {
  return PAD_X + lane * LANE_W + LANE_W / 2;
}

/**
 * Route one edge as elbow → vertical → elbow.
 *
 * The previous version used a single cubic with control points a fixed 0.55 of
 * a row below the child, so an edge spanning thirty rows rendered as a slack
 * diagonal across the whole rail instead of a corner. Corners are now placed
 * relative to the endpoints, and the straight middle carries whatever distance
 * is left — which is what makes a lane readable as one continuous line.
 */
function edgePath(
  childX: number,
  childY: number,
  travelX: number,
  parentX: number,
  parentY: number,
): string {
  const span = parentY - childY;
  // Both corners have to fit in the gap between the two nodes.
  const corner = Math.max(4, Math.min(ELBOW, span / (travelX === childX || travelX === parentX ? 1 : 2)));

  const parts: string[] = [`M ${childX} ${childY}`];
  let y = childY;

  if (travelX !== childX) {
    const to = Math.min(childY + corner, parentY);
    parts.push(`C ${childX} ${childY + corner * 0.6}, ${travelX} ${to - corner * 0.6}, ${travelX} ${to}`);
    y = to;
  }

  if (parentX !== travelX) {
    const from = Math.max(parentY - corner, y);
    if (from > y) parts.push(`L ${travelX} ${from}`);
    parts.push(`C ${travelX} ${from + corner * 0.6}, ${parentX} ${parentY - corner * 0.6}, ${parentX} ${parentY}`);
  } else if (parentY > y) {
    parts.push(`L ${travelX} ${parentY}`);
  }

  return parts.join(" ");
}

export function CommitGraph({
  commits,
  selectedHash,
  onSelect,
  onContextMenu,
  onKebabOpen,
  rowBind,
  unpushedHashes,
  mainRefNames = [],
  identityByEmail,
  wip = null,
  onOpenWip,
  onRowDragStart,
  aheadOfMain,
  forkBase = null,
  forkLabel = null,
  aheadMain = 0,
}: CommitGraphProps) {
  if (commits.length === 0 && !wip) {
    return (
      <div className="repo-git-empty">
        No commits yet — history will show up once this repo has a tip.
      </div>
    );
  }
  return (
    <CommitGraphInner
      commits={commits}
      selectedHash={selectedHash}
      onSelect={onSelect}
      onContextMenu={onContextMenu}
      onKebabOpen={onKebabOpen}
      rowBind={rowBind}
      unpushedHashes={unpushedHashes}
      mainRefNames={mainRefNames}
      identityByEmail={identityByEmail}
      wip={wip}
      onOpenWip={onOpenWip}
      onRowDragStart={onRowDragStart}
      aheadOfMain={aheadOfMain}
      forkBase={forkBase}
      forkLabel={forkLabel}
      aheadMain={aheadMain}
    />
  );
}

/**
 * Windowed rendering body.
 *
 * The scroller is the root `.repo-git-graph` (CSS owns `overflow: auto`), so
 * virtualization only needs its scrollTop and clientHeight: render the rows and
 * graph nodes inside [scrollTop - overscan, scrollTop + height + overscan],
 * absolutely positioned in a spacer of the full height. DOM size is bounded by
 * the window, not the history length — a 5k-commit page renders ~40 rows.
 */
function CommitGraphInner({
  commits,
  selectedHash,
  onSelect,
  onContextMenu,
  onKebabOpen,
  rowBind,
  unpushedHashes,
  mainRefNames = [],
  identityByEmail,
  wip,
  onOpenWip,
  onRowDragStart,
  aheadOfMain,
  forkBase = null,
  forkLabel = null,
  aheadMain = 0,
}: CommitGraphProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);
  const rafPending = useRef(false);

  const onScroll = useCallback(() => {
    if (rafPending.current) return;
    rafPending.current = true;
    requestAnimationFrame(() => {
      rafPending.current = false;
      const el = scrollRef.current;
      if (el) setScrollTop(el.scrollTop);
    });
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewportH(el.clientHeight || 600);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hasWip = Boolean(wip);
  const rowOffset = hasWip ? 1 : 0;
  const totalRows = commits.length + rowOffset;
  const totalH = totalRows * ROW_H;

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(totalRows, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN);

  const y = (row: number) => row * ROW_H + ROW_H / 2;
  const maxLanes = Math.max(1, ...commits.map((c) => c.activeLanes));
  const graphW = PAD_X * 2 + maxLanes * LANE_W;
  const headCommit = commits.find((c) => c.isHead) ?? commits[0] ?? null;
  const wipLane = headCommit ? headCommit.lane : 0;
  const wipCount = wip ? wip.staged + wip.unstaged : 0;

  // Visible slice of the graph nodes/edges. An edge is drawn when either of its
  // endpoints is on-screen; the SVG clips the rest of the path.
  const visibleCommits = commits
    .map((c, i) => ({ c, i }))
    .filter(({ i }) => {
      const row = i + rowOffset;
      return row >= start && row < end;
    });

  return (
    <div ref={scrollRef} className="repo-git-graph" onScroll={onScroll}>
      <div
        className="repo-git-graph-canvas"
        style={{ height: totalH, minWidth: Math.max(graphW + 60, 430) }}
      >
        <div className="repo-git-graph-rail" style={{ width: graphW, height: totalH }}>
          <svg width={graphW} height={totalH} aria-hidden>
            {hasWip && headCommit && (
              <>
                <path
                  d={edgePath(
                    laneX(wipLane),
                    y(0),
                    laneX(wipLane),
                    laneX(headCommit.lane),
                    // Stop at the HEAD node's rim, not its centre.
                    y(commits.indexOf(headCommit) + rowOffset) - (NODE_R + 3),
                  )}
                  fill="none"
                  stroke="var(--text-subtle, var(--text))"
                  strokeWidth={1.5}
                  strokeDasharray="3 3"
                  opacity={0.55}
                />
                <circle
                  cx={laneX(wipLane)}
                  cy={y(0)}
                  r={NODE_R}
                  fill="var(--bg-surface)"
                  stroke="var(--text-subtle, var(--text))"
                  strokeWidth={1.5}
                  strokeDasharray="2.5 2.5"
                />
              </>
            )}
            {visibleCommits.map(({ c, i }) => {
              const x = laneX(c.lane);
              const cy = y(i + rowOffset);
              return (
                <g key={`edges-${c.hash}`}>
                  {c.parentLanes.map((p) => {
                    const travelX = laneX(p.lane);
                    // A parent below the loaded window has no row to aim at. Run
                    // the line off the bottom edge rather than stopping it a few
                    // pixels down, which used to leave an unexplained stub.
                    const offPage = p.row === null || p.row <= i;
                    const parentX = offPage ? travelX : laneX(commits[p.row!]!.lane);
                    const parentY = offPage ? totalH : y(p.row! + rowOffset);
                    return (
                      <path
                        key={`${c.hash}-${p.hash}`}
                        d={edgePath(x, cy, travelX, parentX, parentY)}
                        fill="none"
                        stroke={laneColor(p.color)}
                        strokeWidth={1.75}
                        strokeLinecap="round"
                        opacity={0.9}
                      />
                    );
                  })}
                </g>
              );
            })}
            {visibleCommits.map(({ c, i }) => {
              const x = laneX(c.lane);
              const cy = y(i + rowOffset);
              const selected = selectedHash === c.hash;
              const color = laneColor(c.color);
              return (
                <circle
                  key={`node-${c.hash}`}
                  cx={x}
                  cy={cy}
                  r={c.isHead ? NODE_R + 1.5 : NODE_R}
                  // Merges read as rings so a two-parent commit is identifiable
                  // without tracing its edges back.
                  fill={c.isMerge ? "var(--bg-surface)" : color}
                  stroke={selected ? "var(--text)" : color}
                  strokeWidth={c.isMerge || selected ? 2 : 1.5}
                />
              );
            })}
            {visibleCommits.map(({ c, i }) =>
              // A second, wider ring marks the checked-out commit. Nothing
              // distinguished HEAD before, so on a branch whose name resembles its
              // neighbours there was no way to tell where you were standing.
              c.isHead ? (
                <circle
                  key={`head-${c.hash}`}
                  cx={laneX(c.lane)}
                  cy={y(i + rowOffset)}
                  r={NODE_R + 4}
                  fill="none"
                  stroke={laneColor(c.color)}
                  strokeWidth={1.25}
                  opacity={0.7}
                />
              ) : null,
            )}
          </svg>
        </div>
        {/*
          j/k (and arrows) move the selection. Listening on the container rather
          than each row means it keeps working while focus sits on any row.
        */}
        <div
          className="repo-git-graph-rows"
          onKeyDown={(e) => {
            const delta =
              e.key === "j" || e.key === "ArrowDown" ? 1
              : e.key === "k" || e.key === "ArrowUp" ? -1
              : 0;
            if (delta === 0 || e.metaKey || e.ctrlKey || e.altKey) return;
            e.preventDefault();
            const current = commits.findIndex((c) => c.hash === selectedHash);
            const nextIndex = Math.min(
              commits.length - 1,
              Math.max(0, (current < 0 ? 0 : current) + delta),
            );
            const next = commits[nextIndex];
            if (!next) return;
            onSelect?.(next.hash);
            // Move focus with the selection so repeated presses keep working and
            // the row is scrolled into view for free.
            e.currentTarget
              .querySelectorAll<HTMLElement>(".repo-git-graph-row:not(.repo-git-wip-row)")
              [nextIndex]?.focus();
          }}
        >
          {hasWip && (
            <div
              role="button"
              tabIndex={0}
              className="repo-git-graph-row repo-git-wip-row"
              data-wip-count={wipCount || undefined}
              style={{ top: 0, height: ROW_H }}
              onClick={() => onOpenWip?.()}
              onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                onOpenWip?.();
              }}
            >
              <span className="repo-git-wip-label font-mono">WIP</span>
              <span
                className="repo-git-graph-subject truncate"
                title={
                  wipCount === 0
                    ? "Working tree clean — click to open the Changes tab"
                    : `${wip!.staged} staged · ${wip!.unstaged} unstaged — click to review`
                }
              >
                {wipCount === 0 ? (
                  <span className="repo-git-wip-quiet">clean tree</span>
                ) : (
                  <>
                    <span className="repo-git-wip-chip">{wip!.staged} staged</span>
                    <span className="repo-git-wip-chip">{wip!.unstaged} unstaged</span>
                  </>
                )}
              </span>
              <span className="repo-git-graph-refs" />
              <span className="repo-git-graph-author" />
              <span className="repo-git-graph-kebab" />
            </div>
          )}
          {commits.map((c, i) => {
            const row = i + rowOffset;
            if (row < start || row >= end) return null;
            const selected = selectedHash === c.hash;
            const unpushed = unpushedHashes?.has(c.hash) || unpushedHashes?.has(c.shortHash);
            const onMain = mainRefNames.length > 0 && c.refs.some((ref) => isMainRef(ref, mainRefNames));
            const identity = identityByEmail
              ? lookupByEmail(identityByEmail, c.authorEmail)
              : undefined;
            const isFork = Boolean(forkBase) && (c.hash === forkBase || c.hash.startsWith(forkBase!));
            return (
              <div
                key={c.hash}
                role="button"
                tabIndex={0}
                className="repo-git-graph-row group"
                data-selected={selected || undefined}
                data-unpushed={unpushed || undefined}
                data-on-main={onMain || undefined}
                data-head={c.isHead || undefined}
                data-ahead={aheadOfMain?.has(c.hash) || undefined}
                data-fork={isFork || undefined}
                style={{ top: row * ROW_H, height: ROW_H }}
                {...(rowBind?.(c) ?? {})}
                onPointerDown={(event) => {
                  onRowDragStart?.(event, c);
                  rowBind?.(c)?.onPointerDown(event);
                }}
                onClick={(event) => {
                  rowBind?.(c)?.onClick(event);
                  if (event.defaultPrevented) return;
                  onSelect?.(c.hash);
                }}
                onContextMenu={(event) => {
                  rowBind?.(c)?.onContextMenu(event);
                  onContextMenu?.(event, c);
                }}
                onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                  rowBind?.(c)?.onKeyDown(event);
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onSelect?.(c.hash);
                }}
              >
                <span
                  className="repo-git-graph-hash font-mono"
                  style={{ color: laneColor(c.color) }}
                  title={c.gpg === "G" ? "Signed with a verified GPG signature" : undefined}
                >
                  {c.gpg === "G" ? "✓ " : ""}
                  {c.shortHash}
                </span>
                <span className="repo-git-graph-subject truncate" title={c.subject}>
                  {c.subject}
                </span>
                {/*
                  Rendered even when empty. Skipping the element dropped a grid
                  cell, so on a commit with no refs the author column slid left
                  into the refs track and the whole right-hand edge went ragged.
                */}
                <span className="repo-git-graph-refs">
                  {isFork && forkLabel && (
                    <span
                      className="repo-git-ref-chip repo-git-fork-chip"
                      title={`This branch forked from ${forkLabel} here`}
                    >
                      ⎇ {forkLabel}
                    </span>
                  )}
                  {displayRefs(c).length > 0 &&
                    displayRefs(c)
                      .slice(0, 3)
                      .map((ref) => (
                        <span
                          key={ref}
                          className="repo-git-ref-chip"
                          data-tone={
                            ref === c.headBranch
                              ? "head"
                              : isMainRef(ref, mainRefNames)
                                ? "main"
                                : undefined
                          }
                          title={ref === c.headBranch ? `${ref} — checked out` : ref}
                          data-drop-branch={isBranchDropTarget(ref, c.headBranch) ? ref : undefined}
                        >
                          {ref}
                        </span>
                      ))}
                  {/* How far ahead of main this branch is, right where your eye
                      already is — the HEAD row — instead of only in the strip. */}
                  {c.isHead && aheadMain > 0 && (
                    <span
                      className="repo-git-ahead-pill"
                      title={`${aheadMain} commit${aheadMain === 1 ? "" : "s"} not on ${forkLabel ?? "main"} yet`}
                    >
                      ↑{aheadMain}
                    </span>
                  )}
                </span>
                <span className="repo-git-graph-author">
                  <CommitAvatar
                    author={c.author}
                    email={c.authorEmail}
                    resolvedUrl={identity?.avatarUrl ?? undefined}
                    title={c.authorEmail ? `${c.author} <${c.authorEmail}>` : c.author}
                  />
                  <span className="repo-git-graph-meta">
                    {/*
                      The identity's name rather than the commit's, so a person who
                      commits as "jmc" from one machine and "John McElreavey" from
                      another reads as one contributor down the column. The commit's
                      own name and address stay in the avatar tooltip.
                    */}
                    <span className="truncate">{identity?.displayName || c.author}</span>
                    <span className="repo-git-graph-date">{c.relativeDate}</span>
                  </span>
                </span>
                <span className="repo-git-graph-kebab">
                  {onKebabOpen ? (
                    <RowMenuKebab
                      label={`Actions for ${c.shortHash}`}
                      onOpen={(x, y) => onKebabOpen(x, y, c)}
                    />
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
