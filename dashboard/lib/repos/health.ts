/**
 * Per-repo health scoring — turns `/repos` from a list you scroll into a list
 * you act on.
 *
 * **Scope, honestly.** The roadmap claimed "every input for triage is already
 * collected - git state, branch/PR status, capability detectors, Datadog,
 * compose config". Reading the code, `RepoInfo` carries git basics only
 * (branch, remote, dirty, unpushed). Failing CI checks and dependency age would
 * both need network calls per repo across ~52 repos, which is a different and
 * much slower feature. So this scores what can be known from the working copy
 * essentially for free, and says so rather than pretending to a completeness it
 * doesn't have.
 *
 * Scoring is a pure function over a signals struct, so the weighting is
 * testable without a filesystem.
 */
import fs from "node:fs";
import path from "node:path";

export interface RepoHealthSignals {
  /** Uncommitted files. */
  dirtyCount: number;
  /** Local commits not on the remote. */
  unpushedCount: number;
  /** Days since the last ref update, or null if unknown. */
  staleDays: number | null;
  /** No remote configured at all. */
  hasRemote: boolean;
  /** A CI workflow directory with at least one workflow file. */
  hasCI: boolean;
  /** A README at the top level. */
  hasReadme: boolean;
  /** HEAD is detached — a working copy in this state loses commits easily. */
  detachedHead: boolean;
}

export type HealthLevel = "good" | "warn" | "bad";

export interface RepoHealth {
  score: number;
  level: HealthLevel;
  /** Human-readable reasons, worst first. Empty when nothing is wrong. */
  reasons: string[];
  /**
   * The subset of `reasons` representing possible **data loss** — unpushed
   * commits, no remote, uncommitted work, detached HEAD.
   *
   * This split exists because the first version scored honestly and then
   * rendered every reason, which lit up 38 of 52 real repos, mostly with "no
   * activity in N days". On a machine with 52 checkouts most being dormant is
   * normal, and a warning on three quarters of the list is decoration, not
   * triage. Staleness and missing CI still move the score; they just don't earn
   * a line on the card.
   */
  risks: string[];
}

/** Past this, a branch is "stale" rather than merely quiet. */
export const STALE_DAYS = 60;
export const VERY_STALE_DAYS = 180;

/**
 * Deductions rather than additions, so a repo with nothing wrong scores 100
 * without needing every optional signal present.
 *
 * Weights encode a claim worth stating: **unpushed work is the only signal here
 * that represents possible data loss**, so it outranks tidiness. A repo with no
 * README is untidy; a repo with 40 unpushed commits on a laptop is a backup
 * incident waiting to happen.
 */
export function scoreRepoHealth(s: RepoHealthSignals): RepoHealth {
  let score = 100;
  const reasons: { weight: number; text: string; risk: boolean }[] = [];

  const push = (weight: number, text: string, risk = false) => {
    score -= weight;
    reasons.push({ weight, text, risk });
  };

  if (s.detachedHead) push(25, "Detached HEAD - commits here are easy to lose", true);

  if (s.unpushedCount > 0) {
    // Ramps: 1 unpushed commit is normal, 40 is a problem.
    const weight = Math.min(30, 6 + s.unpushedCount);
    push(weight, `${s.unpushedCount} unpushed commit${s.unpushedCount === 1 ? "" : "s"}`, true);
  }

  if (!s.hasRemote) push(20, "No remote - nothing is backed up", true);

  if (s.dirtyCount > 0) {
    const weight = Math.min(15, 3 + Math.floor(s.dirtyCount / 2));
    push(weight, `${s.dirtyCount} uncommitted file${s.dirtyCount === 1 ? "" : "s"}`, true);
  }

  if (s.staleDays !== null) {
    if (s.staleDays >= VERY_STALE_DAYS) push(15, `No activity in ${Math.floor(s.staleDays)} days`);
    else if (s.staleDays >= STALE_DAYS) push(8, `No activity in ${Math.floor(s.staleDays)} days`);
  }

  if (!s.hasCI) push(8, "No CI workflows");
  if (!s.hasReadme) push(4, "No README");

  score = Math.max(0, Math.min(100, score));
  const sorted = reasons.sort((a, b) => b.weight - a.weight);
  return {
    score,
    level: score >= 80 ? "good" : score >= 50 ? "warn" : "bad",
    reasons: sorted.map((r) => r.text),
    risks: sorted.filter((r) => r.risk).map((r) => r.text),
  };
}

const DAY_MS = 86_400_000;

/** Cheap working-copy probes. No subprocesses, no network. */
export function collectRepoSignals(
  repoPath: string,
  base: { dirtyCount: number; unpushedCount: number; remote: string | null; branch: string | null },
  now = Date.now(),
): RepoHealthSignals {
  const exists = (p: string) => {
    try {
      return fs.existsSync(path.join(repoPath, p));
    } catch {
      return false;
    }
  };

  // `.git/logs/HEAD` is appended on every ref update, so its mtime is the
  // cheapest honest proxy for "when did anything last happen here" — no git
  // subprocess, and it does not lie the way a file mtime in the tree would.
  let staleDays: number | null = null;
  try {
    const { mtimeMs } = fs.statSync(path.join(repoPath, ".git", "logs", "HEAD"));
    staleDays = Math.max(0, (now - mtimeMs) / DAY_MS);
  } catch {
    staleDays = null;
  }

  let hasCI = false;
  try {
    const dir = path.join(repoPath, ".github", "workflows");
    hasCI = fs.readdirSync(dir).some((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  } catch {
    hasCI = false;
  }

  return {
    dirtyCount: base.dirtyCount,
    unpushedCount: base.unpushedCount,
    staleDays,
    hasRemote: Boolean(base.remote),
    hasCI,
    hasReadme: exists("README.md") || exists("README") || exists("readme.md"),
    detachedHead: base.branch === null,
  };
}
