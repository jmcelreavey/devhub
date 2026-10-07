/**
 * "Make sure this repo's conventions are reasonably current" — the one call
 * every automatic trigger goes through (a review starting, a PR being created,
 * an agent asking).
 *
 * Demand-driven on purpose: nothing mines a repo until someone does PR work in
 * it, so having access to hundreds of repos costs nothing. After that it
 * decides whether to mine at all: feature on, repo resolvable, GitHub
 * authenticated, and not mined too recently — and even then the miner only
 * spends a model call when there's new review feedback. A manual refresh from
 * the UI skips this and calls the miner directly.
 */
import { isGithubCliAuthenticated } from "@/lib/gh-exec";
import { parseOwnerRepo } from "@/lib/github/repo-name";
import { githubFullNameForLocalName } from "./local-repos";
import { mineRepoConventions, recentSoftCheck, type MineOutcome } from "./miner";
import { readConventionsPrefs } from "./prefs";
import { readConventions } from "./store";
import { pendingDecisions } from "./prompt";
import type { ConventionsFile, ConventionsPrefs, MineTrigger } from "./types";

export type EnsureStatus =
  | "disabled"
  | "invalid-repo"
  | "no-github"
  | "throttled"
  | "started"
  | "completed"
  | "up-to-date"
  | "timeout"
  | "failed";

export interface EnsureResult {
  status: EnsureStatus;
  repo?: string;
}

export interface EnsureDeps {
  mine: typeof mineRepoConventions;
  isGhAuthenticated: () => Promise<boolean>;
  resolveRepo: (ref: string) => Promise<string | null>;
  now: () => Date;
}

/** A failed run retries sooner than a successful one is refreshed, but never in a tight loop. */
const FAILURE_BACKOFF_HOURS = 1;

export function isThrottled(
  file: ConventionsFile | null,
  prefs: Pick<ConventionsPrefs, "minIntervalHours">,
  now: Date,
  /** An in-memory check for a repo with no file; whichever of the two is newer wins. */
  soft?: { at: string; failed: boolean },
): boolean {
  const fromFile = file?.checkedAt ? { at: file.checkedAt, failed: file.runs[0] !== undefined && !file.runs[0].ok } : undefined;
  const latest = [fromFile, soft]
    .filter((check): check is { at: string; failed: boolean } => check !== undefined)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  if (!latest) return false;
  // One upgrade assessment is due even if the old miner ran recently. Failures retain backoff.
  if (!latest.failed && pendingDecisions(file?.rules ?? []).length > 0) return false;
  const age = now.getTime() - Date.parse(latest.at);
  if (!Number.isFinite(age)) return false;
  const gapHours = latest.failed ? Math.min(prefs.minIntervalHours, FAILURE_BACKOFF_HOURS) : prefs.minIntervalHours;
  return age < gapHours * 3_600_000;
}

/** `owner/repo`, or a local repo folder name resolved through its git remote. */
export async function resolveGithubRepo(ref: string): Promise<string | null> {
  const direct = parseOwnerRepo(ref);
  if (direct) return `${direct.owner}/${direct.name}`;
  try {
    return githubFullNameForLocalName(ref);
  } catch {
    return null;
  }
}

const defaultDeps: EnsureDeps = {
  mine: mineRepoConventions,
  isGhAuthenticated: isGithubCliAuthenticated,
  resolveRepo: resolveGithubRepo,
  now: () => new Date(),
};

function outcomeStatus(outcome: MineOutcome): EnsureStatus {
  if (outcome.status === "failed") return "failed";
  return outcome.status === "up-to-date" ? "up-to-date" : "completed";
}

export async function ensureConventionsFresh(
  ref: string,
  opts: {
    trigger: MineTrigger;
    /** Wait this long for a run to finish before returning `timeout` (the run carries on). 0 = don't wait. */
    waitMs?: number;
    deps?: Partial<EnsureDeps>;
  },
): Promise<EnsureResult> {
  const deps: EnsureDeps = { ...defaultDeps, ...opts.deps };
  const prefs = readConventionsPrefs();
  if (!prefs.enabled) return { status: "disabled" };

  const repo = await deps.resolveRepo(ref);
  if (!repo) return { status: "invalid-repo" };

  if (isThrottled(readConventions(repo), prefs, deps.now(), recentSoftCheck(repo))) return { status: "throttled", repo };
  if (!(await deps.isGhAuthenticated())) return { status: "no-github", repo };

  const run = deps
    .mine(repo, { trigger: opts.trigger })
    .then(outcomeStatus)
    .catch((err: unknown): EnsureStatus => {
      console.error(`[conventions] ${repo}:`, err);
      return "failed";
    });

  if (!opts.waitMs || opts.waitMs <= 0) {
    void run;
    return { status: "started", repo };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<EnsureStatus>((resolve) => {
    timer = setTimeout(() => resolve("timeout"), opts.waitMs);
  });
  const status = await Promise.race([run, timeout]);
  clearTimeout(timer);
  return { status, repo };
}
