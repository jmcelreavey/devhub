import type { BoardCard } from "@/lib/storyboard/notes-board-shared";

export interface PrFeedbackActivity {
  author: string;
  at: string;
  body: string;
  state?: string;
  bot?: boolean;
}

export interface PrFeedbackSnapshot {
  headBranch?: string;
  repo?: string;
  url: string;
  state: string;
  self: string;
  activity: PrFeedbackActivity[];
  failedChecks: Array<{ name: string; at: string }>;
}

export interface FinishedTaskFeedback {
  key: string;
  action: "reopen-feedback" | "follow-up";
  summary: string;
  brief: string;
}

export function finishedTaskFeedback(card: Pick<BoardCard, "taskDone" | "task" | "prUrl"> & Partial<Pick<BoardCard, "links">>, snapshots: readonly PrFeedbackSnapshot[]): FinishedTaskFeedback | null {
  const doneAt = Date.parse(card.task?.completedAt ?? "");
  if (!card.taskDone || !Number.isFinite(doneAt) || !card.prUrl) return null;
  const snapshot = snapshots.find((item) => item.url.toLowerCase() === card.prUrl!.toLowerCase());
  if (!snapshot || !["OPEN", "MERGED"].includes(snapshot.state.toUpperCase())) return null;
  const merged = snapshot.state.toUpperCase() === "MERGED";
  const activity = snapshot.activity.filter((item) => Date.parse(item.at) > doneAt && item.author && snapshot.self && item.author.toLowerCase() !== snapshot.self.toLowerCase() && !item.bot && !/\[bot\]$|^github-actions$|^dependabot$/i.test(item.author) && (item.body.trim() || (!merged && item.state === "CHANGES_REQUESTED"))).sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  const lines = activity.map((item) => `@${item.author}: ${item.body.trim().split(/\r?\n/)[0].slice(0, 240) || "Changes requested"}`);
  const failedChecks = merged ? [] : snapshot.failedChecks.filter((check) => Date.parse(check.at) > doneAt);
  const checkLines = failedChecks.map((check) => `Failing check: ${check.name}`);
  lines.push(...checkLines);
  if (!lines.length) return null;
  const unique = [...new Set(lines)].slice(-20);
  const latestAt = Math.max(...activity.map((item) => Date.parse(item.at)), ...failedChecks.map((check) => Date.parse(check.at)));
  const key = `${new Date(latestAt).toISOString()}-${unique.length}`;
  if (merged && card.links?.some((link) => link.kind === "task" && link.label === `Feedback follow-up ${key}`)) return null;
  const comments = activity.map((item) => `@${item.author}: ${item.body.trim().slice(0, 1800) || "Changes requested"}`);
  const brief = [...new Set([...comments, ...checkLines])].slice(-20).join("\n\n").slice(0, 4000);
  return { key, action: merged ? "follow-up" : "reopen-feedback", summary: unique.slice(0, 3).join(" · ").slice(0, 500), brief };
}
