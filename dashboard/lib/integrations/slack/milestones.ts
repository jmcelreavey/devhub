import { createHash } from "node:crypto";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";

export type SlackMilestoneKind = "plan-ready" | "pr-opened" | "ready-for-review" | "failed" | "needs-input";

export interface SlackMilestone {
  profile: string;
  taskId: string;
  title: string;
  kind: SlackMilestoneKind;
  runId: string;
  /** (profile, task, run, milestone): the same one is announced once, ever. */
  key: string;
  detail?: string;
  /** The PR, for `pr-opened` and `ready-for-review`. */
  url?: string;
  /** For `ready-for-review`: what the forwardable review request names. */
  repo?: string;
  jira?: string[];
}

/** A run that finished longer ago than this is history, not news. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function milestoneKey(profile: string, taskId: string, runId: string, kind: SlackMilestoneKind, extra = ""): string {
  return [profile, taskId, runId, kind, ...(extra ? [createHash("sha256").update(extra).digest("hex").slice(0, 12)] : [])].join(":");
}

function titleOf(card: BoardCard): string {
  const key = card.jira?.[0];
  return key && !card.title.startsWith(key) ? `${key} · ${card.title}` : card.title;
}

/**
 * What an agent run has just reached, read from the board cards the Needs-you tick already loads:
 * a plan finished, a PR opened, a run failed (or auto mode stopped on a failure), or the work is
 * waiting on an answer. Done and abandoned tasks announce nothing.
 */
export function slackMilestonesFromCards(profile: string, cards: readonly BoardCard[], now = Date.now()): SlackMilestone[] {
  return cards.flatMap((card): SlackMilestone[] => {
    if (card.taskDone || card.task?.abandonedAt) return [];
    const touched = Math.max(Date.parse(card.run?.updatedAt ?? "") || 0, Date.parse(card.updatedAt) || 0);
    if (!touched || now - touched > MAX_AGE_MS) return [];
    const base = { profile, taskId: card.taskId, title: titleOf(card) };
    const latest = card.steps[0];
    const out: SlackMilestone[] = [];
    const plan = card.steps.find((step) => step.role === "plan" && step.status === "done");
    if (plan) {
      out.push({ ...base, kind: "plan-ready", runId: plan.runId, detail: card.statusUpdate?.whatChanged || card.summary[0] || undefined, key: milestoneKey(profile, card.taskId, plan.runId, "plan-ready") });
    }
    // At ready-for-review the ready message already carries the PR, so a second "PR opened" would only repeat it.
    if (card.prUrl && card.prState !== "merged" && card.prState !== "closed" && card.status !== "ready-for-review") {
      const run = card.steps.find((step) => step.role === "implement")?.runId ?? "pr";
      // Keyed on the PR, not the run: a retry or a second implement run for the same PR is not a new PR.
      out.push({ ...base, kind: "pr-opened", runId: run, url: card.prUrl, key: milestoneKey(profile, card.taskId, "pr", "pr-opened", card.prUrl) });
    }
    if (card.status === "ready-for-review" && card.prState !== "merged" && card.prState !== "closed") {
      const run = card.steps.find((step) => step.role === "implement")?.runId ?? "ready";
      out.push({ ...base, kind: "ready-for-review", runId: run, ...(card.prUrl ? { url: card.prUrl } : {}), ...(card.repo ? { repo: card.repo } : {}), ...(card.jira?.length ? { jira: [...card.jira] } : {}), key: milestoneKey(profile, card.taskId, "ready", "ready-for-review", card.prUrl ?? "") });
    }
    const stopped = card.auto?.waiting && (card.auto.waiting.kind === "failure" || card.auto.waiting.kind === "cap") ? card.auto.waiting.reason : undefined;
    if (latest?.status === "failed" || stopped) {
      const run = latest?.runId ?? "auto";
      out.push({ ...base, kind: "failed", runId: run, detail: stopped ?? `The ${latest?.label ?? latest?.role ?? "agent"} run failed.`, key: milestoneKey(profile, card.taskId, run, "failed") });
    }
    if (card.attention?.reason === "awaiting" || card.auto?.waiting?.kind === "questions") {
      const run = latest?.runId ?? "none";
      const open = card.counts.openQuestions;
      // No content, no message: "Waiting on you" alone says nothing the Needs-you card doesn't.
      const detail = card.auto?.waiting?.kind === "questions" ? card.auto.waiting.reason : open ? `${open} open question${open === 1 ? "" : "s"}.` : undefined;
      if (detail) out.push({ ...base, kind: "needs-input", runId: run, detail, key: milestoneKey(profile, card.taskId, run, "needs-input") });
    }
    return out;
  });
}
