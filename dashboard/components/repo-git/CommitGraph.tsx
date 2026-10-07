"use client";

import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Check, Cloud, Laptop, Tag } from "lucide-react";
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
  /** Configured remotes, so `upstream/main` reads as remote rather than a local branch. */
  remoteNames?: string[];
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
  /** Click on the WIP row. */
  onOpenWip?: () => void;
  /** Double-click a commit row — History switches to the branch on it. */
  onRowDoubleClick?: (commit: GraphLaneCommit) => void;
  /** The WIP row is the current selection (its changes fill the detail pane). */
  wipSelected?: boolean;
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
  /**
   * Which row columns render (hash / refs / author / date). Omitted = defaults.
   * Subject is always rendered.
   */
  columns?: GraphColumnsPartial;
}

/** Refs you can drop a commit onto: local branches only. */
export function isBranchDropTarget(ref: string, headBranch: string | null): boolean {
  return !ref.startsWith("tag:") && !ref.startsWith("origin/") && ref !== headBranch;
}

/**
 * Optional row columns. Subject is always shown — hiding it leaves nothing to
 * read — but hash, refs, author and the date column can each be turned off,
 * and the grid reflows around what remains.
 */
export interface GraphColumns {
  hash: boolean;
  refs: boolean;
  author: boolean;
  date: boolean;
}

/**
 * Author is off by default: the avatar is the graph node, so a name column
 * repeated it and cost the subject ~150px it could not spare.
 */
export const DEFAULT_GRAPH_COLUMNS: GraphColumns = {
  hash: true,
  refs: true,
  author: false,
  date: true,
};

export type GraphColumnsPartial = Partial<GraphColumns>;

export function resolveColumns(columns?: GraphColumnsPartial): GraphColumns {
  return { ...DEFAULT_GRAPH_COLUMNS, ...columns };
}

/** Track widths in px, so the fit calculation and the grid agree exactly. */
const REFS_W = 150;
const AUTHOR_W = 140;
const DATE_W = 92;
const HASH_W = 72;
const KEBAB_W = 24;
const ROW_PAD_R = 8;
/** Below this the subject stops being readable, and it is the one column that matters. */
const MIN_SUBJECT_W = 220;

/**
 * Grid tracks, left to right: branch/tag labels, the lane rail, subject, then
 * the optional metadata and the kebab. Labels sit left of the rail (as in
 * GitKraken) so a branch name lines up with the node it points at.
 */
export function graphGridTemplate(c: GraphColumns, graphW: number): string {
  const parts: string[] = [];
  if (c.refs) parts.push(`${REFS_W}px`);
  parts.push(`${graphW}px`, "minmax(0, 1fr)");
  if (c.author) parts.push(`${AUTHOR_W}px`);
  if (c.date) parts.push(`${DATE_W}px`);
  if (c.hash) parts.push(`${HASH_W}px`);
  parts.push(`${KEBAB_W}px`);
  return parts.join(" ");
}

/**
 * Drop optional columns until the subject keeps a readable width.
 *
 * Fixed tracks used to win outright: in a 660px history pane hash, refs,
 * author and date summed to the whole row and the subject rendered 0px wide —
 * every commit message was invisible. Author goes first (the node avatar
 * already says who), then hash, then date; labels last, because "where are the
 * branches" is what the graph is for.
 */
export function fitColumns(c: GraphColumns, rowWidth: number, graphW: number): GraphColumns {
  const fitted = { ...c };
  const used = () =>
    graphW +
    KEBAB_W +
    ROW_PAD_R +
    (fitted.refs ? REFS_W : 0) +
    (fitted.author ? AUTHOR_W : 0) +
    (fitted.date ? DATE_W : 0) +
    (fitted.hash ? HASH_W : 0);
  for (const key of ["author", "hash", "date", "refs"] as const) {
    if (rowWidth - used() >= MIN_SUBJECT_W) break;
    fitted[key] = false;
  }
  return fitted;
}

/** One label in the branch/tag column. A local branch and its origin copy share one. */
export interface RefLabel {
  label: string;
  kind: "branch" | "tag";
  local: boolean;
  remote: boolean;
  head: boolean;
  /** Local branch name when there is one — the drag-and-drop target. */
  localName: string | null;
  /** Remote ref (`origin/feat/x`) when the branch exists on a remote. */
  remoteRef: string | null;
  /** Remote the ref belongs to, so the branch name can be recovered from it. */
  remoteName: string | null;
  title: string;
}

/**
 * Fold a commit's decorations into labels.
 *
 * `main` and `origin/main` on the same commit become one "main" label with a
 * laptop and a cloud, so "in sync with origin" reads at a glance; when they
 * sit on different rows the gap between them *is* the ahead/behind. Other
 * remotes keep their prefix (`upstream/main`) so they can't pass for origin.
 * `*\/HEAD` aliases are dropped — they always shadow a real branch on the same
 * commit. Order: checked-out branch, local branches, remote-only, then tags.
 */
export function groupRefLabels(
  refs: string[],
  headBranch: string | null,
  configuredRemotes: string[] = [],
): RefLabel[] {
  // Unknown (branches payload failed) still treats `origin/*` as remote.
  const remoteNames = configuredRemotes.length > 0 ? configuredRemotes : ["origin"];
  const primaryRemote = remoteNames.includes("origin") ? "origin" : remoteNames[0]!;
  const branches = new Map<string, { label: RefLabel; parts: string[] }>();
  const tags: RefLabel[] = [];
  for (const ref of refs) {
    if (ref.endsWith("/HEAD")) continue;
    if (ref.startsWith("tag:")) {
      const name = ref.slice("tag:".length);
      tags.push({
        label: name,
        kind: "tag",
        local: false,
        remote: false,
        head: false,
        localName: null,
        remoteRef: null,
        remoteName: null,
        title: `tag ${name}`,
      });
      continue;
    }
    const remote = remoteNames.find((r) => ref.startsWith(`${r}/`)) ?? null;
    const name = remote === primaryRemote ? ref.slice(remote.length + 1) : ref;
    const entry = branches.get(name) ?? {
      label: {
        label: name,
        kind: "branch" as const,
        local: false,
        remote: false,
        head: false,
        localName: null,
        remoteRef: null,
        remoteName: null,
        title: name,
      },
      parts: [],
    };
    if (remote) {
      entry.label.remote = true;
      entry.label.remoteRef ??= ref;
      entry.label.remoteName ??= remote;
      entry.parts.push(ref);
    } else {
      entry.label.local = true;
      entry.label.localName = ref;
      entry.label.head = ref === headBranch;
      entry.parts.unshift(entry.label.head ? `${ref} — checked out` : ref);
    }
    entry.label.title = entry.parts.join(" · ");
    branches.set(name, entry);
  }
  const ordered = [...branches.values()]
    .map((entry) => entry.label)
    .sort((a, b) => Number(b.head) - Number(a.head) || Number(b.local) - Number(a.local));
  return [...ordered, ...tags];
}

export type SwitchTarget =
  | { kind: "local"; branch: string }
  | { kind: "remote"; remoteRef: string; localName: string };

/**
 * What double-clicking a graph row switches to, GitKraken-style: the first
 * branch on that commit you are not already on, local before remote-only. A
 * remote-only branch whose name already exists locally switches to the local
 * one rather than failing to create a duplicate. Null = nothing to switch to
 * (no branch here, or it is the one checked out).
 */
export function pickSwitchTarget(
  labels: RefLabel[],
  localBranches: ReadonlySet<string>,
): SwitchTarget | null {
  const target = labels.find((l) => l.kind === "branch" && !l.head);
  if (!target) return null;
  if (target.localName) return { kind: "local", branch: target.localName };
  if (!target.remoteRef || !target.remoteName) return null;
  const localName = target.remoteRef.slice(target.remoteName.length + 1);
  return localBranches.has(localName)
    ? { kind: "local", branch: localName }
    : { kind: "remote", remoteRef: target.remoteRef, localName };
}

const ROW_H = 28;
const LANE_W = 18;
const PAD_X = 12;
/** Avatar node diameter; the lane-coloured ring sits outside it. */
const NODE_AVATAR = 16;
/** Visible radius of a node including its ring — where edges and connectors stop. */
const NODE_RING_R = NODE_AVATAR / 2 + 2;
const WIP_NODE_R = 5;
/** Vertical distance an elbow takes to change lane. Kept under one row so a
 *  branch that lives for a single commit still reads as a corner, not a wedge. */
const ELBOW = ROW_H * 0.8;
/** Rows rendered beyond the visible window, so scroll never shows a blank edge. */
const OVERSCAN = 12;

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

export function CommitGraph(props: CommitGraphProps) {
  if (props.commits.length === 0 && !props.wip) {
    return (
      <div className="repo-git-empty">
        No commits yet — history will show up once this repo has a tip.
      </div>
    );
  }
  return <CommitGraphInner {...props} />;
}

/** Rows scrolled before the rendered window moves. */
const WINDOW_STEP = 8;

/**
 * Handlers a row calls. One stable object for the graph's lifetime — each
 * method reads the latest props through a ref — so memoized rows are not
 * invalidated by the parent passing fresh inline callbacks on every render.
 */
interface RowActions {
  select: (hash: string) => void;
  doubleClick: (commit: GraphLaneCommit) => void;
  contextMenu: (event: MouseEvent<HTMLElement>, commit: GraphLaneCommit) => void;
  kebab: ((x: number, y: number, commit: GraphLaneCommit) => void) | null;
  dragStart: (event: ReactPointerEvent<HTMLDivElement>, commit: GraphLaneCommit) => void;
  bind: (commit: GraphLaneCommit) => RowMenuBind | undefined;
}

/**
 * Windowed rendering body.
 *
 * The scroller is the root `.repo-git-graph` (CSS owns `overflow: auto`), so
 * virtualization only needs its scrollTop and clientHeight: render the rows and
 * graph edges inside the visible window plus overscan, absolutely positioned
 * in a spacer of the full height. DOM size is bounded by the window, not the
 * history length — a 5k-commit page renders ~50 rows.
 *
 * Scroll only re-renders when the window moves by WINDOW_STEP rows (rows are
 * absolutely positioned, so nothing on screen changes in between), and rows
 * are memoized, so selecting a commit re-renders two rows rather than fifty.
 *
 * Layering: edges are one SVG underneath; rows sit on top with translucent
 * hover/selection fills, and each row draws its own node. That way a
 * highlighted row runs through the graph instead of stopping beside it, and
 * hovering a row can grow its node with plain CSS.
 */
function CommitGraphInner(props: CommitGraphProps) {
  const {
    commits,
    selectedHash,
    onSelect,
    onKebabOpen,
    unpushedHashes,
    mainRefNames = [],
    remoteNames,
    identityByEmail,
    wip,
    onOpenWip,
    wipSelected = false,
    aheadOfMain,
    forkBase = null,
    forkLabel = null,
    aheadMain = 0,
    columns,
  } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [windowBase, setWindowBase] = useState(0);
  const [viewport, setViewport] = useState({ w: 0, h: 600 });

  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const hasKebab = Boolean(onKebabOpen);
  const actions = useMemo<RowActions>(
    () => ({
      select: (hash) => latest.current.onSelect?.(hash),
      doubleClick: (commit) => latest.current.onRowDoubleClick?.(commit),
      contextMenu: (event, commit) => latest.current.onContextMenu?.(event, commit),
      kebab: hasKebab ? (x, y, commit) => latest.current.onKebabOpen?.(x, y, commit) : null,
      dragStart: (event, commit) => latest.current.onRowDragStart?.(event, commit),
      bind: (commit) => latest.current.rowBind?.(commit),
    }),
    [hasKebab],
  );

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const base = Math.floor(el.scrollTop / ROW_H / WINDOW_STEP) * WINDOW_STEP;
    setWindowBase(base);
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewport({ w: el.clientWidth, h: el.clientHeight || 600 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hasWip = Boolean(wip);
  const rowOffset = hasWip ? 1 : 0;
  const totalRows = commits.length + rowOffset;
  const totalH = totalRows * ROW_H;

  const start = Math.max(0, windowBase - OVERSCAN);
  const end = Math.min(
    totalRows,
    windowBase + Math.ceil(viewport.h / ROW_H) + WINDOW_STEP + OVERSCAN,
  );

  const maxLanes = useMemo(
    () => commits.reduce((max, c) => Math.max(max, c.activeLanes), 1),
    [commits],
  );
  const graphW = PAD_X * 2 + maxLanes * LANE_W;
  const requested = resolveColumns(columns);
  // Unmeasured (first paint, jsdom) keeps what was asked for rather than
  // collapsing every column against a width of 0.
  const fitted = viewport.w > 0 ? fitColumns(requested, viewport.w, graphW) : requested;
  // Keyed on the values so memoized rows see the same object until a column
  // actually appears or disappears.
  const colsKey = `${fitted.refs}${fitted.hash}${fitted.author}${fitted.date}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- colsKey encodes every field of `fitted`
  const cols = useMemo(() => fitted, [colsKey]);
  const gridTemplate = graphGridTemplate(cols, graphW);
  const graphLeft = cols.refs ? REFS_W : 0;
  const minCanvasW = graphLeft + graphW + MIN_SUBJECT_W + KEBAB_W + ROW_PAD_R;
  const wipCount = wip ? wip.staged + wip.unstaged : 0;
  const mainKey = mainRefNames.join("\0");

  return (
    <div ref={scrollRef} className="repo-git-graph" onScroll={onScroll}>
      <div className="repo-git-graph-canvas" style={{ height: totalH, minWidth: minCanvasW }}>
        <div className="repo-git-graph-rail" style={{ left: graphLeft, width: graphW, height: totalH }}>
          <GraphEdges
            commits={commits}
            start={start}
            end={end}
            rowOffset={rowOffset}
            graphW={graphW}
            totalH={totalH}
            hasWip={hasWip}
          />
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
            // Rows are windowed, so the next one may not be in the DOM yet —
            // scroll it into range, then move focus once it has rendered.
            const scroller = scrollRef.current;
            if (scroller) {
              const top = (nextIndex + rowOffset) * ROW_H;
              if (top < scroller.scrollTop) scroller.scrollTop = top;
              else if (top + ROW_H > scroller.scrollTop + scroller.clientHeight) {
                scroller.scrollTop = top + ROW_H - scroller.clientHeight;
              }
            }
            requestAnimationFrame(() => {
              scroller
                ?.querySelector<HTMLElement>(`.repo-git-graph-row[data-hash="${next.hash}"]`)
                ?.focus({ preventScroll: true });
            });
          }}
        >
          {hasWip && (
            <div
              role="button"
              tabIndex={0}
              className="repo-git-graph-row repo-git-wip-row"
              data-selected={wipSelected || undefined}
              data-wip-count={wipCount || undefined}
              style={{ top: 0, height: ROW_H, gridTemplateColumns: gridTemplate }}
              onClick={() => onOpenWip?.()}
              onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                onOpenWip?.();
              }}
            >
              {cols.refs && <span className="repo-git-graph-refs" />}
              <span className="repo-git-graph-lane" />
              <span
                className="repo-git-graph-subject truncate"
                title={
                  wipCount === 0
                    ? "Working tree clean"
                    : `${wip!.staged} staged · ${wip!.unstaged} unstaged — click to review`
                }
              >
                <span className="repo-git-wip-label">WIP</span>
                {wipCount === 0 ? (
                  <span className="repo-git-wip-quiet">clean tree</span>
                ) : (
                  <>
                    <span className="repo-git-wip-chip">{wip!.staged} staged</span>
                    <span className="repo-git-wip-chip">{wip!.unstaged} unstaged</span>
                  </>
                )}
              </span>
              {cols.author && <span className="repo-git-graph-author" />}
              {cols.date && <span className="repo-git-graph-date-cell" />}
              {cols.hash && <span className="repo-git-graph-hash" />}
              <span className="repo-git-graph-kebab" />
            </div>
          )}
          {commits.slice(Math.max(0, start - rowOffset), Math.max(0, end - rowOffset)).map((c, offset) => {
            const i = Math.max(0, start - rowOffset) + offset;
            const isFork = Boolean(forkBase) && (c.hash === forkBase || c.hash.startsWith(forkBase!));
            return (
              <GraphRow
                key={c.hash}
                commit={c}
                top={(i + rowOffset) * ROW_H}
                gridTemplate={gridTemplate}
                cols={cols}
                selected={selectedHash === c.hash}
                unpushed={Boolean(unpushedHashes?.has(c.hash) || unpushedHashes?.has(c.shortHash))}
                onMain={mainKey !== "" && c.refs.some((ref) => isMainRef(ref, mainRefNames))}
                ahead={Boolean(aheadOfMain?.has(c.hash))}
                forkLabel={isFork ? forkLabel : null}
                isFork={isFork}
                aheadMain={c.isHead ? aheadMain : 0}
                identity={identityByEmail ? lookupByEmail(identityByEmail, c.authorEmail) : undefined}
                remoteNames={remoteNames}
                actions={actions}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Lane edges for the rendered window. Memoized on its own so selecting,
 * hovering or refreshing detail never re-lays the SVG.
 */
const GraphEdges = memo(function GraphEdges({
  commits,
  start,
  end,
  rowOffset,
  graphW,
  totalH,
  hasWip,
}: {
  commits: GraphLaneCommit[];
  start: number;
  end: number;
  rowOffset: number;
  graphW: number;
  totalH: number;
  hasWip: boolean;
}) {
  const y = (row: number) => row * ROW_H + ROW_H / 2;
  const headIndex = commits.findIndex((c) => c.isHead);
  const headCommit = commits[headIndex >= 0 ? headIndex : 0] ?? null;
  const wipLane = headCommit ? headCommit.lane : 0;
  const first = Math.max(0, start - rowOffset);
  const last = Math.max(0, end - rowOffset);
  return (
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
              y(Math.max(0, headIndex) + rowOffset) - NODE_RING_R,
            )}
            fill="none"
            stroke="var(--text-subtle, var(--text))"
            strokeWidth={1.5}
            strokeDasharray="3 3"
            opacity={0.6}
          />
          <circle
            cx={laneX(wipLane)}
            cy={y(0)}
            r={WIP_NODE_R}
            fill="var(--bg-surface)"
            stroke="var(--text-subtle, var(--text))"
            strokeWidth={1.5}
            strokeDasharray="2.5 2.5"
          />
        </>
      )}
      {commits.slice(first, last).map((c, offset) => {
        const i = first + offset;
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
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
});

interface GraphRowProps {
  commit: GraphLaneCommit;
  top: number;
  gridTemplate: string;
  cols: GraphColumns;
  selected: boolean;
  unpushed: boolean;
  onMain: boolean;
  ahead: boolean;
  isFork: boolean;
  forkLabel: string | null;
  aheadMain: number;
  identity: { avatarUrl: string | null; displayName: string } | undefined;
  remoteNames: string[] | undefined;
  actions: RowActions;
}

const GraphRow = memo(function GraphRow({
  commit: c,
  top,
  gridTemplate,
  cols,
  selected,
  unpushed,
  onMain,
  ahead,
  isFork,
  forkLabel,
  aheadMain,
  identity,
  remoteNames,
  actions,
}: GraphRowProps) {
  const authorName = identity?.displayName || c.author;
  const color = laneColor(c.color);
  const labels = groupRefLabels(c.refs, c.headBranch, remoteNames);
  const [primary, ...extra] = labels;
  const showFork = isFork && Boolean(forkLabel) && !primary;
  const hasLabel = cols.refs && (Boolean(primary) || showFork);
  const bind = actions.bind(c);
  return (
    <div
      role="button"
      tabIndex={0}
      className="repo-git-graph-row group"
      data-hash={c.hash}
      data-selected={selected || undefined}
      data-unpushed={unpushed || undefined}
      data-on-main={onMain || undefined}
      data-head={c.isHead || undefined}
      data-merge={c.isMerge || undefined}
      data-ahead={ahead || undefined}
      data-fork={isFork || undefined}
      style={
        {
          top,
          height: ROW_H,
          gridTemplateColumns: gridTemplate,
          "--lane": color,
        } as CSSProperties
      }
      {...(bind ?? {})}
      onPointerDown={(event) => {
        actions.dragStart(event, c);
        bind?.onPointerDown(event);
      }}
      onClick={(event) => {
        bind?.onClick(event);
        if (event.defaultPrevented) return;
        actions.select(c.hash);
      }}
      onDoubleClick={() => actions.doubleClick(c)}
      onContextMenu={(event) => {
        bind?.onContextMenu(event);
        actions.contextMenu(event, c);
      }}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        bind?.onKeyDown(event);
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        actions.select(c.hash);
      }}
    >
      {/*
        Rendered even when empty. Skipping the element dropped a grid
        cell, so on a commit with no refs every later column slid left
        into the wrong track.
      */}
      {cols.refs && (
        <span className="repo-git-graph-refs">
          {primary ? (
            <span
              className="repo-git-lane-chip"
              data-head={primary.head || undefined}
              title={`${labels.map((l) => l.title).join("\n")}${primary.head ? "" : "\nDouble-click to switch"}`}
              data-drop-branch={
                primary.localName && isBranchDropTarget(primary.localName, c.headBranch)
                  ? primary.localName
                  : undefined
              }
            >
              {primary.head && <Check size={11} strokeWidth={3} aria-hidden />}
              <span className="truncate">{primary.label}</span>
              {primary.kind === "tag" ? (
                <Tag size={10} aria-label="tag" />
              ) : (
                <>
                  {primary.local && <Laptop size={11} aria-label="local" />}
                  {primary.remote && <Cloud size={11} aria-label="on remote" />}
                </>
              )}
            </span>
          ) : showFork ? (
            <span
              className="repo-git-lane-chip repo-git-fork-chip"
              title={`This branch forked from ${forkLabel} here`}
            >
              <span className="truncate">⎇ {forkLabel}</span>
            </span>
          ) : null}
          {extra.length > 0 && (
            <span className="repo-git-lane-more" title={extra.map((l) => l.title).join("\n")}>
              +{extra.length}
            </span>
          )}
          {/* How far ahead of main this branch is, right where your eye
              already is — the HEAD row — instead of only in the strip. */}
          {aheadMain > 0 && (
            <span
              className="repo-git-ahead-pill"
              title={`${aheadMain} commit${aheadMain === 1 ? "" : "s"} not on ${forkLabel ?? "main"} yet`}
            >
              ↑{aheadMain}
            </span>
          )}
        </span>
      )}
      <span className="repo-git-graph-lane" aria-hidden>
        {hasLabel && (
          // Ties the label to its node, so a name never reads as
          // belonging to a neighbouring lane.
          <span className="repo-git-ref-link" style={{ width: laneX(c.lane) - NODE_RING_R + 6 }} />
        )}
        <span
          className="repo-git-graph-node"
          data-kind={c.isMerge ? "merge" : "avatar"}
          data-head={c.isHead || undefined}
          style={{ left: laneX(c.lane) }}
        >
          {/* Merges stay small dots, as in GitKraken: they carry no
              work of their own and a face there reads as authorship. */}
          {!c.isMerge && (
            <CommitAvatar
              author={authorName}
              email={c.authorEmail}
              size={NODE_AVATAR}
              resolvedUrl={identity?.avatarUrl ?? undefined}
              title={c.authorEmail ? `${authorName} <${c.authorEmail}>` : authorName}
            />
          )}
        </span>
      </span>
      <span className="repo-git-graph-subject truncate" title={`${c.subject}\n${authorName} · ${c.relativeDate}`}>
        {c.subject}
      </span>
      {cols.author && <span className="repo-git-graph-author truncate">{authorName}</span>}
      {cols.date && (
        <span className="repo-git-graph-date-cell" title={c.relativeDate}>
          {c.relativeDate}
        </span>
      )}
      {cols.hash && (
        <span
          className="repo-git-graph-hash font-mono"
          title={c.gpg === "G" ? "Signed with a verified GPG signature" : undefined}
        >
          {c.gpg === "G" ? "✓ " : ""}
          {c.shortHash}
        </span>
      )}
      <span className="repo-git-graph-kebab">
        {actions.kebab ? (
          <RowMenuKebab
            label={`Actions for ${c.shortHash}`}
            onOpen={(x, y) => actions.kebab?.(x, y, c)}
          />
        ) : null}
      </span>
    </div>
  );
});
