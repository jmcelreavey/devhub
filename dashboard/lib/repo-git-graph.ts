import type { GraphCommitRaw } from "./repo-git-parsers";

export interface GraphLaneCommit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  relativeDate: string;
  refs: string[];
  /** Lane index for this commit's node (0-based). */
  lane: number;
  /** Parent hashes with assigned lane for edge drawing. */
  parentLanes: { hash: string; lane: number }[];
  /** Active lane count at this row (for SVG width). */
  activeLanes: number;
}

const LANE_COLORS = [
  "var(--accent)",
  "var(--success)",
  "var(--warning)",
  "#3b82f6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#8b5cf6",
];

export function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length]!;
}

/**
 * Assign graph lanes top-to-bottom (newest first). Prefer keeping a commit on
 * its first parent's lane; allocate the lowest free lane for merges/forks.
 */
export function layoutCommitGraph(commits: GraphCommitRaw[]): GraphLaneCommit[] {
  const laneByHash = new Map<string, number>();
  const freeLanes: number[] = [];
  let nextLane = 0;

  function allocLane(): number {
    if (freeLanes.length > 0) {
      freeLanes.sort((a, b) => a - b);
      return freeLanes.shift()!;
    }
    return nextLane++;
  }

  const rows: GraphLaneCommit[] = [];

  for (const c of commits) {
    let lane = laneByHash.get(c.hash);
    if (lane === undefined) {
      lane = allocLane();
      laneByHash.set(c.hash, lane);
    }

    const parentLanes: { hash: string; lane: number }[] = [];
    c.parents.forEach((parentHash, i) => {
      let pLane = laneByHash.get(parentHash);
      if (pLane === undefined) {
        // First parent continues this lane; others get fresh lanes.
        pLane = i === 0 ? lane! : allocLane();
        laneByHash.set(parentHash, pLane);
      }
      parentLanes.push({ hash: parentHash, lane: pLane });
    });

    // When this commit has no children waiting on this lane (we're walking
    // newest→oldest), free the lane after forking to multiple parents — except
    // the first parent which continues the lane.
    if (c.parents.length === 0) {
      freeLanes.push(lane);
    } else if (c.parents.length > 1) {
      // Merge: first parent keeps lane; nothing to free yet.
    }

    const activeLanes = Math.max(nextLane, ...[lane, ...parentLanes.map((p) => p.lane)], 1);

    rows.push({
      hash: c.hash,
      shortHash: c.shortHash,
      subject: c.subject,
      author: c.author,
      relativeDate: c.relativeDate,
      refs: c.refs,
      lane,
      parentLanes,
      activeLanes,
    });
  }

  // Second pass: activeLanes = max lane index seen so far from the top.
  let maxLane = 0;
  return rows.map((row) => {
    maxLane = Math.max(maxLane, row.lane, ...row.parentLanes.map((p) => p.lane));
    return { ...row, activeLanes: maxLane + 1 };
  });
}
