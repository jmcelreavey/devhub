import type { ObligationCell, RepoObligations, RepoPrRadarRow } from "./types";
import { statusTone } from "@/lib/status";

/**
 * Weights for the "needs attention" figure.
 *
 * These exist because an unweighted count is dominated by whatever is most
 * numerous rather than whatever is most urgent: a repo with 20 stale local
 * branches and a red default branch reads as "24 items", burying the one that
 * matters. Anything that blocks other people scores highest; housekeeping is
 * fractional so it still registers without shouting.
 */
export const ATTENTION_WEIGHTS = {
  failingCi: 10,
  unattendedPr: 3,
  stalePr: 2,
  botPr: 0.5,
  staleBranch: 0.25,
  unassignedIssue: 0.1,
} as const;

export interface AttentionSummary {
  score: number;
  /** Human-readable reasons, most urgent first. Empty when nothing needs attention. */
  reasons: string[];
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Rank what an owner should look at first.
 *
 * Returns reasons rather than only a number so the UI can say *why* a repo is
 * flagged; "24 items need attention" is not actionable, "default branch CI is
 * failing" is.
 */
export function attentionSummary(obligations: RepoObligations, prs: RepoPrRadarRow[]): AttentionSummary {
  const unattended = prs.filter((pr) => pr.review.nobodyLooking && !pr.isDraft).length;
  const stalePrs = prs.filter((pr) => pr.stale && !pr.review.nobodyLooking && !pr.isDraft).length;
  const entries: { score: number; reason: string }[] = [
    {
      score: obligations.defaultBranchCi === "failing" ? ATTENTION_WEIGHTS.failingCi : 0,
      reason: "default branch CI is failing",
    },
    {
      score: unattended * ATTENTION_WEIGHTS.unattendedPr,
      reason: `${plural(unattended, "pull request")} with nobody looking`,
    },
    { score: stalePrs * ATTENTION_WEIGHTS.stalePr, reason: `${plural(stalePrs, "stale pull request")}` },
    { score: obligations.botPrs * ATTENTION_WEIGHTS.botPr, reason: `${plural(obligations.botPrs, "bot pull request")}` },
    {
      score: obligations.staleBranches.length * ATTENTION_WEIGHTS.staleBranch,
      reason: `${plural(obligations.staleBranches.length, "stale branch", "stale branches")}`,
    },
    {
      score: (obligations.unassignedIssues ?? 0) * ATTENTION_WEIGHTS.unassignedIssue,
      reason: `${plural(obligations.unassignedIssues ?? 0, "unassigned issue")}`,
    },
  ];
  const active = entries.filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
  return {
    score: Number(active.reduce((sum, entry) => sum + entry.score, 0).toFixed(2)),
    reasons: active.map((entry) => entry.reason),
  };
}

/**
 * The obligation strip, as data.
 *
 * The `unknown` tone is the point of this function: a failed GitHub call and a
 * green build are different facts, and rendering both with a success dot makes
 * the strip assert something it does not know.
 */
export function obligationCells(obligations: RepoObligations): ObligationCell[] {
  const { defaultBranchCi, staleBranches, botPrs, unassignedIssues } = obligations;
  return [
    {
      label: "Default CI",
      value: defaultBranchCi,
      tone: statusTone(defaultBranchCi),
      weight: defaultBranchCi === "failing" ? ATTENTION_WEIGHTS.failingCi : 0,
    },
    {
      label: "Stale branches",
      value: String(staleBranches.length),
      tone: staleBranches.length > 0 ? "bad" : "ok",
      weight: staleBranches.length * ATTENTION_WEIGHTS.staleBranch,
    },
    {
      label: "Bot PRs",
      value: String(botPrs),
      tone: botPrs > 0 ? "bad" : "ok",
      weight: botPrs * ATTENTION_WEIGHTS.botPr,
    },
    {
      label: "Unassigned issues",
      value: unassignedIssues === null ? "unknown" : String(unassignedIssues),
      tone: unassignedIssues === null ? "unknown" : unassignedIssues > 0 ? "bad" : "ok",
      weight: (unassignedIssues ?? 0) * ATTENTION_WEIGHTS.unassignedIssue,
    },
  ];
}
