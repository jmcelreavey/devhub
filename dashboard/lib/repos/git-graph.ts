import type { GraphCommitRaw } from "@/lib/repos/git-parsers";

/**
 * One commit → parent edge, resolved to the lane the edge travels in.
 *
 * An edge is drawn in three parts: an optional elbow out of the child's lane
 * into `lane`, a vertical run down `lane`, and an optional elbow out of `lane`
 * into the lane the parent actually landed in. The travel lane is not always
 * the parent's own lane: when several children share a parent, each child keeps
 * its own lane down the page and they converge at the parent's row, which is
 * what makes a branch read as a continuous line for its whole life.
 */
export interface GraphParentLink {
  hash: string;
  /** Lane the edge runs down. */
  lane: number;
  /** Palette index for the edge, stable for as long as the lane holds one branch. */
  color: number;
  /** Row of the parent in this same layout, or null when it falls outside the page. */
  row: number | null;
}

export interface GraphLaneCommit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  authorEmail: string;
  relativeDate: string;
  refs: string[];
  isHead: boolean;
  headBranch: string | null;
  /** Original parent hashes, retained so paginated pages can be laid out together. */
  parents: string[];
  /** Lane index for this commit's node (0-based). */
  lane: number;
  /** Palette index for this commit's branch. */
  color: number;
  /** More than one parent — drawn as a ring rather than a filled dot. */
  isMerge: boolean;
  /** Parent hashes with assigned lane for edge drawing. */
  parentLanes: GraphParentLink[];
  /** Total lane count for the whole layout (for SVG width). */
  activeLanes: number;
}

/**
 * Fixed hues rather than theme variables. The palette used to start
 * `--accent, --success, --warning`, and in several themes accent and success
 * are both green (`#9ed84a` / `#8fbf52` in the matrix theme), so neighbouring
 * lanes were indistinguishable — the graph read as one colour even where it had
 * genuinely branched. These are picked to stay separable against both light and
 * dark surfaces, and to keep adjacent entries far apart in hue.
 */
const LANE_COLORS = [
  "#4f9dff",
  "#f0883e",
  "#a371f7",
  "#3fb950",
  "#e5657f",
  "#2bc4c0",
  "#d2a336",
  "#7c8cf8",
];

/** Palette lookup. Takes a colour index from the layout, not a lane index. */
export function laneColor(color: number): string {
  const index = ((color % LANE_COLORS.length) + LANE_COLORS.length) % LANE_COLORS.length;
  return LANE_COLORS[index]!;
}

/**
 * Assign graph lanes top-to-bottom (newest first).
 *
 * Lanes are modelled as slots holding the hash they are waiting to reach, so a
 * lane is released the moment its last child has been placed and can be reused
 * further down the page. The previous version only ever released a lane at a
 * root commit, which does not occur inside a paginated window, so lane indices
 * grew without bound and the rail filled with dead columns.
 *
 * Colour is keyed on lane *occupancy* rather than lane index: a lane keeps its
 * colour for as long as it holds one branch, and takes a new one when it is
 * recycled. Keying on the index alone made a branch change colour whenever the
 * layout happened to move it.
 *
 * Expects input in `--date-order` (or `--topo-order`), i.e. no parent before
 * its children. Out-of-order input still lays out, but a parent seen before its
 * child opens a fresh lane instead of continuing the child's.
 */
export function layoutCommitGraph(commits: GraphCommitRaw[]): GraphLaneCommit[] {
  const rowOf = new Map<string, number>();
  commits.forEach((c, i) => {
    if (!rowOf.has(c.hash)) rowOf.set(c.hash, i);
  });

  /** lanes[i] = hash lane i is waiting to place, or null when the lane is free. */
  const lanes: (string | null)[] = [];
  /** Palette index currently assigned to each lane. */
  const laneColorIndex: number[] = [];
  let nextColor = 0;

  function takeFreeLane(): number {
    const reused = lanes.indexOf(null);
    if (reused !== -1) return reused;
    lanes.push(null);
    laneColorIndex.push(0);
    return lanes.length - 1;
  }

  const rows: Omit<GraphLaneCommit, "activeLanes">[] = [];
  let maxLane = 0;

  for (const c of commits) {
    // Lanes a child already reserved for this commit.
    const claimed: number[] = [];
    lanes.forEach((waiting, index) => {
      if (waiting === c.hash) claimed.push(index);
    });

    let lane: number;
    let color: number;
    if (claimed.length > 0) {
      lane = claimed[0]!;
      color = laneColorIndex[lane]!;
      // Every other claimant converges here and gives its lane back.
      for (const extra of claimed.slice(1)) lanes[extra] = null;
    } else {
      // A branch tip, or a commit whose children are above this page.
      lane = takeFreeLane();
      color = nextColor++;
      laneColorIndex[lane] = color;
    }
    lanes[lane] = null;

    const parentLanes: GraphParentLink[] = [];
    c.parents.forEach((parentHash, i) => {
      if (i === 0) {
        // The first parent continues this commit's lane and colour.
        lanes[lane] = parentHash;
        laneColorIndex[lane] = color;
        parentLanes.push({ hash: parentHash, lane, color, row: rowOf.get(parentHash) ?? null });
        return;
      }
      // A merged-in branch. Reuse the lane if something already waits for this
      // parent, so two merges of the same branch do not open two columns.
      const existing = lanes.indexOf(parentHash);
      if (existing !== -1) {
        parentLanes.push({
          hash: parentHash,
          lane: existing,
          color: laneColorIndex[existing]!,
          row: rowOf.get(parentHash) ?? null,
        });
        return;
      }
      const merged = takeFreeLane();
      const mergedColor = nextColor++;
      lanes[merged] = parentHash;
      laneColorIndex[merged] = mergedColor;
      parentLanes.push({
        hash: parentHash,
        lane: merged,
        color: mergedColor,
        row: rowOf.get(parentHash) ?? null,
      });
    });

    maxLane = Math.max(maxLane, lane, ...parentLanes.map((p) => p.lane));

    rows.push({
      hash: c.hash,
      shortHash: c.shortHash,
      subject: c.subject,
      author: c.author,
      authorEmail: c.authorEmail,
      relativeDate: c.relativeDate,
      refs: c.refs,
      isHead: c.isHead,
      headBranch: c.headBranch,
      parents: c.parents,
      lane,
      color,
      isMerge: c.parents.length > 1,
      parentLanes,
    });
  }

  // One width for the whole rail, so lanes do not shift horizontally as you
  // scroll — a per-row width made the same branch appear to drift sideways.
  const activeLanes = maxLane + 1;
  return rows.map((row) => ({ ...row, activeLanes }));
}

/**
 * Parent hashes referenced by this page that have no row in it — the open
 * frontier. Paging from these as tips continues the walk exactly where it
 * stopped, which `--skip` cannot do once the walk covers more than one tip.
 */
export function openBoundary(commits: GraphCommitRaw[]): string[] {
  const present = new Set(commits.map((c) => c.hash));
  const boundary = new Set<string>();
  for (const c of commits) {
    for (const parent of c.parents) {
      if (!present.has(parent)) boundary.add(parent);
    }
  }
  return [...boundary];
}
