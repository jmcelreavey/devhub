"use client";

import { laneColor, type GraphLaneCommit } from "@/lib/repo-git-graph";

interface CommitGraphProps {
  commits: GraphLaneCommit[];
  selectedHash?: string | null;
  onSelect?: (hash: string) => void;
  /** Full or short hashes of commits ahead of upstream — lightly marked in the list. */
  unpushedHashes?: Set<string>;
}

const ROW_H = 32;
const LANE_W = 14;
const PAD_X = 10;
const NODE_R = 4;

export function CommitGraph({ commits, selectedHash, onSelect, unpushedHashes }: CommitGraphProps) {
  if (commits.length === 0) {
    return (
      <div className="repo-git-empty">
        No commits yet — history will show up once this repo has a tip.
      </div>
    );
  }

  const maxLanes = Math.max(1, ...commits.map((c) => c.activeLanes));
  const graphW = PAD_X * 2 + maxLanes * LANE_W;
  const height = commits.length * ROW_H;

  // Parent hash → first row index where it appears as a node (walking top→bottom).
  const rowByHash = new Map(commits.map((c, i) => [c.hash, i]));

  return (
    <div className="repo-git-graph">
      <div className="repo-git-graph-rail" style={{ width: graphW }}>
        <svg width={graphW} height={height} aria-hidden>
          {commits.map((c, i) => {
            const x = PAD_X + c.lane * LANE_W + LANE_W / 2;
            const y = i * ROW_H + ROW_H / 2;
            return (
              <g key={`edges-${c.hash}`}>
                {c.parentLanes.map((p) => {
                  const parentRow = rowByHash.get(p.hash);
                  const x2 = PAD_X + p.lane * LANE_W + LANE_W / 2;
                  const y2 = parentRow !== undefined
                    ? parentRow * ROW_H + ROW_H / 2
                    : (i + 1) * ROW_H + ROW_H / 2;
                  const color = laneColor(p.lane === c.lane ? c.lane : p.lane);
                  if (x === x2) {
                    return (
                      <line
                        key={`${c.hash}-${p.hash}`}
                        x1={x}
                        y1={y}
                        x2={x2}
                        y2={y2}
                        stroke={color}
                        strokeWidth={1.5}
                        opacity={0.75}
                      />
                    );
                  }
                  const midY = y + ROW_H * 0.55;
                  return (
                    <path
                      key={`${c.hash}-${p.hash}`}
                      d={`M ${x} ${y} C ${x} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                      fill="none"
                      stroke={color}
                      strokeWidth={1.5}
                      opacity={0.75}
                    />
                  );
                })}
              </g>
            );
          })}
          {commits.map((c, i) => {
            const x = PAD_X + c.lane * LANE_W + LANE_W / 2;
            const y = i * ROW_H + ROW_H / 2;
            const selected = selectedHash === c.hash;
            return (
              <circle
                key={`node-${c.hash}`}
                cx={x}
                cy={y}
                r={NODE_R}
                fill={laneColor(c.lane)}
                stroke={selected ? "var(--text)" : "var(--bg-surface)"}
                strokeWidth={selected ? 2 : 1.5}
              />
            );
          })}
        </svg>
      </div>
      <div className="repo-git-graph-rows">
        {commits.map((c) => {
          const selected = selectedHash === c.hash;
          const unpushed = unpushedHashes?.has(c.hash) || unpushedHashes?.has(c.shortHash);
          return (
            <button
              key={c.hash}
              type="button"
              className="repo-git-graph-row"
              data-selected={selected || undefined}
              data-unpushed={unpushed || undefined}
              style={{ height: ROW_H }}
              onClick={() => onSelect?.(c.hash)}
            >
              <span className="repo-git-graph-hash font-mono">{c.shortHash}</span>
              <span className="repo-git-graph-subject truncate" title={c.subject}>
                {c.subject}
              </span>
              {c.refs.length > 0 && (
                <span className="repo-git-graph-refs">
                  {c.refs.slice(0, 3).map((ref) => (
                    <span key={ref} className="repo-git-ref-chip">{ref}</span>
                  ))}
                </span>
              )}
              <span className="repo-git-graph-meta">
                <span className="truncate">{c.author}</span>
                <span className="repo-git-graph-date">{c.relativeDate}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
