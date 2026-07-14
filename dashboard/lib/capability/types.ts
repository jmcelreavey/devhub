/**
 * Capability Radar — shared types.
 *
 * A "signal" is one detected technology, pattern, or concept in a repo, backed
 * by evidence (matched file paths). Signals from every scanned repo roll up into
 * a dated aggregate snapshot; comparing two snapshots produces a diff (the
 * "engineering evolution" of your environment).
 */

export type SignalKind = "technology" | "pattern" | "concept";

export type SignalArea =
  | "runtime"
  | "infra"
  | "deploy"
  | "data"
  | "observability"
  | "ci"
  | "arch";

export interface DetectedSignal {
  /** Stable id, e.g. "flux", "terraform", "workload-identity". */
  id: string;
  label: string;
  kind: SignalKind;
  area: SignalArea;
  /** Matched file paths (relative to repo root), deduped and capped. */
  evidence: string[];
  /** Occurrences that contributed to this signal. */
  count: number;
  /** 0..1 — filename matches score higher than loose content keyword hits. */
  confidence: number;
}

export type RepoSource = "local" | "github";

export interface RepoScan {
  repoName: string;
  /** Local absolute path, or `github:owner/repo` for remote-only repos. */
  repoRef: string;
  source: RepoSource;
  /** Commit SHA the scan reflects (branch head), when known. */
  sha: string | null;
  /** How deeply a remote repo was probed. Local scans are always "full". */
  depth: "full" | "tree" | "cached" | "skipped";
  scannedAt: string;
  signals: DetectedSignal[];
  /** Personal exposure per signal id → ISO date you last touched its files. */
  lastTouchedByMe: Record<string, string | null>;
}

export interface SignalRollup {
  id: string;
  label: string;
  kind: SignalKind;
  area: SignalArea;
  /** Repo names this signal appears in. */
  repos: string[];
  /** Sum of per-repo counts. */
  count: number;
}

export interface CapabilitySnapshot {
  /** Filesystem-safe id derived from createdAt. */
  id: string;
  createdAt: string;
  repoCount: number;
  source: { local: number; github: number };
  /** Rollups keyed by signal id. */
  signals: Record<string, SignalRollup>;
  /** Trimmed per-repo scans (evidence capped) for drill-down + explain. */
  repos: RepoScan[];
}

export interface DiffEntry {
  id: string;
  label: string;
  kind: SignalKind;
  area: SignalArea;
  repos: string[];
  /** For `spread`: repo count now vs at the previous snapshot. */
  fromRepoCount?: number;
  toRepoCount?: number;
  evidence: string[];
}

export interface DriftEntry {
  id: string;
  label: string;
  area: SignalArea;
  /** Days since you last touched this signal's files anywhere. null = never. */
  daysSinceMine: number | null;
  /** How many more repos it's in vs the previous snapshot. */
  repoDelta: number;
  repoCount: number;
}

export interface CapabilityDiff {
  fromId: string | null;
  toId: string;
  /** New signals not present in the previous snapshot. */
  added: DiffEntry[];
  /** Signals that disappeared entirely. */
  removed: DiffEntry[];
  /** Existing signals now present in strictly more repos. */
  spread: DiffEntry[];
  /** Signals growing while your hands-on exposure is stale. */
  drift: DriftEntry[];
}
