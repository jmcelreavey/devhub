import { MODEL_TIERS, type ModelTier, type ModelTierSettings, type TierStep } from "./model-tiers-shared";
import type { AutoPhase } from "./types";

/**
 * Dynamic tiers for auto mode. Each phase starts on its step's saved tier and
 * moves within the saved cheap / mid / heavy choices:
 *
 * - up one per retry after a failed run, and when a fix round follows one that
 *   didn't clear the bugs;
 * - up to heavy for a large diff, or one step for a long list of findings
 *   (review + Jev);
 * - down to cheap for a trivial step (opening the draft PR) or a trivial diff;
 * - never down for a review or fix when the diff is missing, unreadable or
 *   empty: an unknown change is treated as a big one (heavy).
 *
 * The reason is recorded on the run so the card's run line can say why.
 */

export interface DiffStats {
  files: number;
  lines: number;
}

export const LARGE_DIFF = { lines: 800, files: 25 };
export const TRIVIAL_DIFF = { lines: 30, files: 2 };
export const MANY_FINDINGS = 5;

export function tierStepForPhase(phase: AutoPhase): TierStep {
  switch (phase) {
    case "plan":
      return "plan";
    case "draft-pr":
      return "draft-pr";
    case "verify":
      return "review";
    default:
      return "implement";
  }
}

const rank = (tier: ModelTier) => MODEL_TIERS.indexOf(tier);
const atRank = (value: number): ModelTier => MODEL_TIERS[Math.max(0, Math.min(MODEL_TIERS.length - 1, value))];

export interface AutoTierInput {
  settings: ModelTierSettings;
  phase: AutoPhase;
  /** Retries of this phase (0 = first try). */
  attempt: number;
  /** Fix round (fix phase), or the round a review checks. */
  round: number;
  diff?: DiffStats | null;
  /** Review + Jev findings handed to a fix run. */
  findings?: number;
}

export function pickAutoTier(input: AutoTierInput): { tier: ModelTier; reason?: string } {
  const base = input.settings.steps[tierStepForPhase(input.phase)];
  const reasons: string[] = [];
  let level = rank(base);
  const diff = input.diff;
  const checksDiff = input.phase === "verify" || input.phase === "fix";
  // No diff, an unreadable one or an empty one says nothing about the change: never let that make a review or fix cheaper.
  const unknownDiff = checksDiff && (!diff || diff.files === 0 || !Number.isFinite(diff.lines) || !Number.isFinite(diff.files));
  const large = unknownDiff || (diff && (diff.lines >= LARGE_DIFF.lines || diff.files >= LARGE_DIFF.files));
  const trivial = !unknownDiff && diff && diff.lines <= TRIVIAL_DIFF.lines && diff.files <= TRIVIAL_DIFF.files;
  const diffText = diff ? `${diff.lines} line${diff.lines === 1 ? "" : "s"}, ${diff.files} file${diff.files === 1 ? "" : "s"}` : "";

  if (input.phase === "draft-pr" && input.attempt === 0) {
    level = rank("cheap");
    reasons.push("opening the draft PR is a small step");
  } else if (checksDiff && large) {
    level = rank("heavy");
    reasons.push(unknownDiff ? "couldn't measure the diff, so it's treated as a big change" : `big change (${diffText})`);
  } else if (checksDiff && trivial && input.attempt === 0 && (input.findings ?? 0) < MANY_FINDINGS) {
    level = rank("cheap");
    reasons.push(`small change (${diffText})`);
  }
  if (input.phase === "fix" && input.round > 1) {
    level += input.round - 1;
    reasons.push(`fix round ${input.round}: the last round didn't clear the bugs`);
  }
  if (input.phase === "fix" && (input.findings ?? 0) >= MANY_FINDINGS && !large) {
    level += 1;
    reasons.push(`${input.findings} problems found by review and Jev`);
  }
  if (input.attempt > 0) {
    level += input.attempt;
    reasons.push(input.attempt === 1 ? "retried after a failed run" : `retry ${input.attempt} after failed runs`);
  }
  const tier = atRank(level);
  if (tier === base) return { tier };
  const direction = rank(tier) > rank(base) ? "Stronger" : "Lighter";
  return { tier, reason: `${direction} model (${base} → ${tier}): ${reasons.join("; ")}` };
}

/** `git diff --numstat` output → files and changed lines (binary files count as one line). */
export function parseNumstat(output: string): DiffStats {
  let files = 0;
  let lines = 0;
  for (const row of output.split("\n")) {
    const [added, removed] = row.split("\t");
    if (added === undefined || removed === undefined || !row.trim()) continue;
    files += 1;
    lines += added === "-" ? 1 : Number(added) + Number(removed);
  }
  return { files, lines };
}
