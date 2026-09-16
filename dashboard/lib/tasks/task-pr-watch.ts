/**
 * Follows the pull request each task's latest agent run produced.
 *
 * - Finds the PR (by the run's branch) when the run didn't record one.
 * - Records merged / closed so the task can offer Complete / Abandon — it
 *   asks, it never closes the task itself.
 * - Raises `attention` when CI fails, changes are requested, or someone else
 *   comments, so the task offers "Fix PR with agent" (a Resume that quotes the
 *   failure). A dismissed or acted-on attention stays quiet until the PR head
 *   or the finding changes.
 *
 * Runs every DEVHUB_TASK_PR_WATCH_INTERVAL_MS (default 10m) while the dashboard
 * is up; POST /api/tasks/pr-watch runs a pass on demand. The same tick drafts
 * tasks from new on-call alerts when that's switched on (alert-drafts.ts).
 */
import fs from "node:fs";
import { execGh, isGithubCliAuthenticated } from "@/lib/gh-exec";
import { countChecks } from "@/lib/github/pr-state";
import { draftTasksFromAlerts } from "@/lib/tasks/alert-drafts";
import {
  isActiveTaskAgentRunStatus,
  listTaskAgentRunTaskIds,
  listTaskAgentRuns,
  patchTaskAgentRun,
  type TaskAgentRunPatch,
  type TaskAgentRunRecord,
  type TaskPrAttention,
} from "@/lib/tasks/task-agent-runs";

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
const EXCERPT_CHARS = 160;

interface GhAuthor {
  login?: string;
}

export interface TaskPrView {
  url?: string;
  state?: string;
  headRefOid?: string;
  reviewDecision?: string | null;
  statusCheckRollup?: Parameters<typeof countChecks>[0] | null;
  reviews?: Array<{ author?: GhAuthor | null; state?: string; submittedAt?: string; body?: string }>;
  comments?: Array<{ author?: GhAuthor | null; createdAt?: string; body?: string }>;
}

function excerpt(text: string | undefined): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_CHARS ? `${flat.slice(0, EXCERPT_CHARS - 1)}…` : flat;
}

function findAttention(view: TaskPrView, since: string, self: string | null): Omit<TaskPrAttention, "detectedAt" | "key"> | null {
  const { failed } = countChecks(view.statusCheckRollup ?? []);
  if (failed.length > 0) {
    return { kind: "ci-failing", summary: `Failing checks: ${failed.slice(0, 5).join(", ")}` };
  }
  const reviews = (view.reviews ?? []).filter((r) => r.submittedAt);
  if (view.reviewDecision === "CHANGES_REQUESTED") {
    const latest = reviews
      .filter((r) => r.state === "CHANGES_REQUESTED")
      .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""))[0];
    const who = latest?.author?.login ? `@${latest.author.login}` : "A reviewer";
    return { kind: "changes-requested", summary: `${who} requested changes${latest?.body ? `: ${excerpt(latest.body)}` : ""}` };
  }
  const others = [
    ...reviews.map((r) => ({ login: r.author?.login, at: r.submittedAt ?? "", body: r.body })),
    ...(view.comments ?? []).map((c) => ({ login: c.author?.login, at: c.createdAt ?? "", body: c.body })),
  ]
    .filter((a) => a.at > since && a.body?.trim() && a.login && a.login !== self)
    .sort((a, b) => b.at.localeCompare(a.at));
  if (others.length > 0) {
    const latest = others[0]!;
    const more = others.length > 1 ? ` (+${others.length - 1} more)` : "";
    return { kind: "new-comments", summary: `@${latest.login}: ${excerpt(latest.body)}${more}` };
  }
  return null;
}

/** Pure: what the watcher should store for this run given the PR it just read. */
export function assessTaskPr(
  view: TaskPrView,
  record: TaskAgentRunRecord,
  opts: { now: string; self: string | null },
): TaskAgentRunPatch {
  const raw = (view.state ?? "OPEN").toUpperCase();
  const prState = raw === "MERGED" ? "merged" : raw === "CLOSED" ? "closed" : "open";
  const patch: TaskAgentRunPatch = {
    prUrl: view.url ?? record.prUrl,
    prState,
    prCheckedAt: opts.now,
    // First sighting: earlier comments were visible to the agent that opened the PR.
    prSeenAt: record.prSeenAt ?? opts.now,
    attention: undefined,
  };
  if (prState !== "open") return patch;

  const found = findAttention(view, patch.prSeenAt!, opts.self);
  if (!found) return patch;
  const key = `${found.kind}:${view.headRefOid ?? ""}:${found.summary}`;
  if (key === record.attentionHandled) return patch;
  patch.attention = {
    ...found,
    key,
    detectedAt: record.attention?.key === key ? record.attention.detectedAt : opts.now,
  };
  return patch;
}

const PR_VIEW_FIELDS = "url,state,headRefOid,reviewDecision,statusCheckRollup,reviews,comments";

async function readPrView(url: string): Promise<TaskPrView | null> {
  try {
    const { stdout } = await execGh(["pr", "view", url, "--json", PR_VIEW_FIELDS], { timeoutMs: 20_000 });
    return JSON.parse(stdout) as TaskPrView;
  } catch {
    return null;
  }
}

/** Newest PR (any state) whose head is `branch`, from inside the checkout. */
async function findPrUrlForBranch(cwd: string, branch: string): Promise<string | null> {
  // Worktrees get cleaned up; gh can't run from a directory that's gone.
  if (!fs.existsSync(cwd)) return null;
  try {
    const { stdout } = await execGh(
      ["pr", "list", "--head", branch, "--state", "all", "--limit", "1", "--json", "url"],
      { cwd, timeoutMs: 20_000 },
    );
    const rows = JSON.parse(stdout) as Array<{ url?: string }>;
    return rows[0]?.url ?? null;
  } catch {
    return null;
  }
}

let selfLogin: string | null | undefined;
async function githubLogin(): Promise<string | null> {
  if (selfLogin !== undefined) return selfLogin;
  try {
    selfLogin = (await execGh(["api", "user", "--jq", ".login"], { timeoutMs: 10_000 })).stdout.trim() || null;
  } catch {
    selfLogin = null;
  }
  return selfLogin;
}

/** The runs worth checking: each task's latest run, finished, with a PR or a branch to find one. */
export function runsToWatch(): Array<{ taskId: string; run: TaskAgentRunRecord }> {
  const out: Array<{ taskId: string; run: TaskAgentRunRecord }> = [];
  for (const taskId of listTaskAgentRunTaskIds()) {
    const run = listTaskAgentRuns(taskId)[0];
    if (!run || isActiveTaskAgentRunStatus(run.status)) continue;
    if (run.prState === "merged" || run.prState === "closed") continue;
    if (!run.prUrl && !(run.branch && run.cwd)) continue;
    out.push({ taskId, run });
  }
  return out;
}

export interface TaskPrWatchResult {
  checked: number;
  attention: number;
  merged: number;
  closed: number;
}

/** One pass over every watched run. */
export async function watchTaskPrs(now = new Date()): Promise<TaskPrWatchResult> {
  const result: TaskPrWatchResult = { checked: 0, attention: 0, merged: 0, closed: 0 };
  if (!(await isGithubCliAuthenticated())) return result;
  const self = await githubLogin();
  for (const { taskId, run } of runsToWatch()) {
    const ref = run.prUrl ?? (run.cwd && run.branch ? await findPrUrlForBranch(run.cwd, run.branch) : null);
    if (!ref) continue;
    const view = await readPrView(ref);
    if (!view) continue;
    const patch = assessTaskPr(view, run, { now: now.toISOString(), self });
    await patchTaskAgentRun(taskId, run.runId, patch);
    result.checked += 1;
    if (patch.attention) result.attention += 1;
    if (patch.prState === "merged") result.merged += 1;
    if (patch.prState === "closed") result.closed += 1;
  }
  return result;
}

/** User dismissed the attention, or launched the agent to fix it: stay quiet until it changes. */
export async function handleTaskPrAttention(taskId: string, runId: string, now = new Date()): Promise<TaskAgentRunRecord | null> {
  const run = listTaskAgentRuns(taskId).find((r) => r.runId === runId);
  if (!run) return null;
  return patchTaskAgentRun(taskId, runId, {
    attention: undefined,
    attentionHandled: run.attention?.key ?? run.attentionHandled,
    prSeenAt: now.toISOString(),
  });
}

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

async function tick(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const result = await watchTaskPrs();
    const drafted = await draftTasksFromAlerts().catch(() => 0);
    if (result.attention || result.merged || result.closed || drafted) {
      console.info(
        "[task-pr-watch]",
        `checked=${result.checked} attention=${result.attention} merged=${result.merged} closed=${result.closed} alertDrafts=${drafted}`,
      );
    }
  } catch (err) {
    console.error("[task-pr-watch] tick failed:", err);
  } finally {
    inFlight = false;
  }
}

export function runTaskPrWatchNow(): Promise<void> {
  return tick();
}

export function startTaskPrWatcher(): void {
  if (timer) return;
  const raw = Number.parseInt(process.env.DEVHUB_TASK_PR_WATCH_INTERVAL_MS ?? "", 10);
  const intervalMs = Math.max(60_000, Number.isFinite(raw) ? raw : DEFAULT_INTERVAL_MS);
  void tick();
  timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
}
