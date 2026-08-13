/**
 * "You usually also change X" — co-change statistics from local history.
 *
 * Measured on this repo's own history, `manifest.ts` had never been committed
 * without `types.ts` across 261 commits, and `bi-ops.ts` carried its test 78% of
 * the time. Those are forgotten-companion detectors that no remote service can
 * offer, because the evidence is the commit log sitting on disk.
 */

export interface CouplingCommit {
  /** Repo-relative paths touched by one commit. */
  files: string[];
}

export interface CouplingSuggestion {
  /** The file you are not currently changing. */
  path: string;
  /** Commits where both files changed. */
  together: number;
  /** Commits touching the file you *are* changing. */
  totalForSource: number;
  /** together / totalForSource — "when I touch A, I touch B this often". */
  confidence: number;
  /** The staged/dirty file that triggered the suggestion. */
  because: string;
}

/**
 * Commits touching more than this are treated as sweeps (mass renames, format
 * runs, dependency bumps) and skipped: they couple everything to everything and
 * would drown the real signal.
 */
const MAX_FILES_PER_COMMIT = 25;

/** Below this, "always changes together" is just a coincidence with n=2. */
const MIN_SUPPORT = 5;

/** Under this ratio it isn't a habit, it's noise. */
const MIN_CONFIDENCE = 0.6;

/** History window. Far enough back to be evidence, near enough to be current. */
const COMMIT_LIMIT = 800;
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface CouplingIndex {
  /** Commits (post-filtering) each file appears in. */
  fileCounts: Map<string, number>;
  /** `a\0b` (a < b) → commits containing both. */
  pairCounts: Map<string, number>;
  /** Commits actually considered. */
  commitsAnalysed: number;
}

const cache = new Map<string, { index: CouplingIndex; built: number }>();

const pairKey = (a: string, b: string) => (a < b ? `${a}\0${b}` : `${b}\0${a}`);

export function buildCouplingIndex(commits: CouplingCommit[]): CouplingIndex {
  const fileCounts = new Map<string, number>();
  const pairCounts = new Map<string, number>();
  let commitsAnalysed = 0;

  for (const commit of commits) {
    const files = [...new Set(commit.files)].filter(Boolean);
    if (files.length < 2 || files.length > MAX_FILES_PER_COMMIT) continue;
    commitsAnalysed += 1;
    for (const f of files) fileCounts.set(f, (fileCounts.get(f) ?? 0) + 1);
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const key = pairKey(files[i]!, files[j]!);
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  return { fileCounts, pairCounts, commitsAnalysed };
}

export async function loadCouplingIndex(repoRoot: string, cacheKey: string): Promise<CouplingIndex | null> {
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.built < CACHE_TTL_MS) return hit.index;

  const { runGitRepoAsync } = await import("@/lib/git/repo-local");
  const log = await runGitRepoAsync(
    repoRoot,
    ["log", `--max-count=${COMMIT_LIMIT}`, "--name-only", "--no-merges", "--pretty=format:%x00%H"],
    { timeout: 30_000 },
  );
  if (log.status !== 0) return null;

  const commits: CouplingCommit[] = [];
  let current: string[] | null = null;
  for (const line of log.stdout.split("\n")) {
    if (line.startsWith("\0")) {
      if (current) commits.push({ files: current });
      current = [];
      continue;
    }
    const filePath = line.trim();
    if (filePath && current) current.push(filePath);
  }
  if (current) commits.push({ files: current });

  const index = buildCouplingIndex(commits);
  cache.set(cacheKey, { index, built: Date.now() });
  return index;
}

/**
 * Companions for the current change set.
 *
 * Directional on purpose. `globals.css` co-occurs with half the codebase, so a
 * symmetric measure would suggest it constantly; asking "given I touched A, how
 * often did I touch B" scores that pair at ~12% and drops it, while keeping the
 * 100% `manifest.ts → types.ts` direction.
 */
export function suggestCompanions(
  index: CouplingIndex,
  changedPaths: string[],
  opts: { minSupport?: number; minConfidence?: number; limit?: number } = {},
): CouplingSuggestion[] {
  const minSupport = opts.minSupport ?? MIN_SUPPORT;
  const minConfidence = opts.minConfidence ?? MIN_CONFIDENCE;
  const limit = opts.limit ?? 5;

  const changed = new Set(changedPaths);
  const best = new Map<string, CouplingSuggestion>();

  for (const source of changed) {
    const totalForSource = index.fileCounts.get(source) ?? 0;
    if (totalForSource < minSupport) continue;

    for (const [key, together] of index.pairCounts) {
      if (together < minSupport) continue;
      const sep = key.indexOf("\0");
      const a = key.slice(0, sep);
      const b = key.slice(sep + 1);
      if (a !== source && b !== source) continue;
      const other = a === source ? b : a;
      // Already changing it — nothing to warn about.
      if (changed.has(other)) continue;

      const confidence = together / totalForSource;
      if (confidence < minConfidence) continue;

      const prev = best.get(other);
      if (!prev || confidence > prev.confidence) {
        best.set(other, { path: other, together, totalForSource, confidence, because: source });
      }
    }
  }

  return [...best.values()]
    .sort((x, y) => y.confidence - x.confidence || y.together - x.together)
    .slice(0, limit);
}
