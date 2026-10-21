/**
 * Safety net for PRs left as drafts: when a task is completed (or its Jira
 * ticket moves to Code Review through DevHub), mark the task's own draft PRs
 * ready for review with `gh pr ready`.
 *
 * - Looks at the task's PR links and the PRs its implementation runs recorded.
 * - Only touches open drafts authored by the signed-in GitHub user, so a task
 *   that reviewed someone else's draft never publishes it.
 * - Idempotent: ready, merged and closed PRs are skipped without a note.
 * - Every PR it readies, and every one it couldn't, goes in the task note's log.
 */
import { execGh } from "@/lib/gh-exec";
import { getActiveTasksDir } from "@/lib/content/dirs";
import { listTaskAgentRuns, type TaskAgentRunRecord } from "@/lib/tasks/task-agent-runs";
import { updateTaskNoteSections } from "@/lib/tasks/task-note-sections";
import { findTask, readItems } from "@shared/tasks/store.ts";
import type { Task } from "@shared/tasks/types.ts";

export type ReadyPrResult = "readied" | "already-ready" | "not-open" | "not-mine" | "failed";

export interface ReadyPrOutcome {
  url: string;
  result: ReadyPrResult;
  detail?: string;
}

export interface ReadyPrDeps {
  gh: (args: string[]) => Promise<{ stdout: string }>;
  runs: (taskId: string) => TaskAgentRunRecord[];
  log: (taskId: string, message: string) => void;
}

const defaultDeps: ReadyPrDeps = {
  gh: (args) => execGh(args, { timeoutMs: 20_000 }),
  runs: (taskId) => listTaskAgentRuns(taskId),
  log: (taskId, message) => { updateTaskNoteSections({ taskId }, { op: "append_log", message }); },
};

const PR_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/;
const PR_ID = /^([\w.-]+)\/([\w.-]+)#(\d+)$/;

/** Canonical https://github.com/owner/repo/pull/n for a PR URL or `owner/repo#n` id, else null. */
export function canonicalPrUrl(value: string | undefined): string | null {
  const text = value?.trim() ?? "";
  const match = PR_URL.exec(text) ?? PR_ID.exec(text);
  return match ? `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}` : null;
}

/** The task's PRs: its pr links, then PRs its implementation runs recorded. Deduplicated. */
export function linkedPrUrls(task: Pick<Task, "links">, runs: TaskAgentRunRecord[]): string[] {
  const urls = new Set<string>();
  for (const link of task.links ?? []) {
    if (link.kind !== "pr") continue;
    const url = canonicalPrUrl(link.href) ?? canonicalPrUrl(link.id);
    if (url) urls.add(url);
  }
  for (const run of runs) {
    if (run.role && run.role !== "implement") continue;
    const url = canonicalPrUrl(run.prUrl);
    if (url) urls.add(url);
  }
  return [...urls];
}

function errorText(error: unknown): string {
  const raw = error instanceof Error ? ((error as Error & { stderr?: string }).stderr || error.message) : String(error);
  return raw.replace(/\s+/g, " ").trim().slice(0, 300) || "unknown error";
}

async function readyOne(url: string, viewer: string | null, deps: ReadyPrDeps): Promise<ReadyPrOutcome> {
  let view: { state?: string; isDraft?: boolean; author?: { login?: string } | null };
  try {
    view = JSON.parse((await deps.gh(["pr", "view", url, "--json", "state,isDraft,author"])).stdout);
  } catch (error) {
    return { url, result: "failed", detail: `couldn't read the PR: ${errorText(error)}` };
  }
  if ((view.state ?? "").toUpperCase() !== "OPEN") return { url, result: "not-open" };
  if (!view.isDraft) return { url, result: "already-ready" };
  const author = view.author?.login ?? null;
  if (!viewer) return { url, result: "failed", detail: "couldn't tell which GitHub user is signed in to gh" };
  if (author?.toLowerCase() !== viewer.toLowerCase()) return { url, result: "not-mine", detail: author ? `authored by @${author}` : undefined };
  try {
    await deps.gh(["pr", "ready", url]);
    return { url, result: "readied" };
  } catch (error) {
    return { url, result: "failed", detail: errorText(error) };
  }
}

const inFlight = new Map<string, Promise<ReadyPrOutcome[]>>();

/**
 * Mark the task's own open draft PRs ready for review. Never throws: failures
 * come back as outcomes and are written to the task note's log.
 */
export function readyLinkedDraftPrs(taskId: string, reason: string, deps: ReadyPrDeps = defaultDeps): Promise<ReadyPrOutcome[]> {
  const running = inFlight.get(taskId);
  if (running) return running;
  const work = (async () => {
    const task = findTask(getActiveTasksDir(), taskId);
    if (!task) return [];
    let runs: TaskAgentRunRecord[] = [];
    try { runs = deps.runs(task.id); } catch { /* no run records */ }
    const urls = linkedPrUrls(task, runs);
    if (!urls.length) return [];
    let viewer: string | null = null;
    try { viewer = (await deps.gh(["api", "user", "--jq", ".login"])).stdout.trim() || null; } catch { /* reported per PR */ }
    const outcomes: ReadyPrOutcome[] = [];
    for (const url of urls) outcomes.push(await readyOne(url, viewer, deps));
    for (const outcome of outcomes) {
      const line = outcome.result === "readied"
        ? `Marked ${outcome.url} ready for review (${reason}).`
        : outcome.result === "failed"
          ? `Couldn't mark ${outcome.url} ready for review (${reason}): ${outcome.detail}. Run \`gh pr ready ${outcome.url}\` to do it by hand.`
          : null;
      if (!line) continue;
      try { deps.log(task.id, line); } catch (error) { console.warn(`[ready-linked-prs] couldn't log on task ${task.id}: ${errorText(error)}`); }
      if (outcome.result === "failed") console.warn(`[ready-linked-prs] ${line}`);
    }
    return outcomes;
  })().catch((error) => {
    console.warn(`[ready-linked-prs] task ${taskId}: ${errorText(error)}`);
    return [];
  }).finally(() => inFlight.delete(taskId));
  inFlight.set(taskId, work);
  return work;
}

/** Ids of every task linked to a Jira ticket, open or done. */
export function taskIdsForJiraKey(key: string): string[] {
  const wanted = key.trim().toUpperCase();
  if (!wanted) return [];
  return readItems(getActiveTasksDir()).filter((task) => task.jiraKey?.toUpperCase() === wanted).map((task) => task.id);
}

/** True when a Jira status name means the work is up for code review. */
export function isCodeReviewStatus(name: unknown): boolean {
  return typeof name === "string" && /\b(code[\s-]*review|in[\s-]*review|ready[\s-]*for[\s-]*review|peer[\s-]*review)\b/i.test(name);
}

/** Fire-and-forget form for request handlers: the response doesn't wait on GitHub. */
export function queueReadyLinkedDraftPrs(taskId: string, reason: string): void {
  try { void readyLinkedDraftPrs(taskId, reason); } catch (error) { console.warn(`[ready-linked-prs] task ${taskId}: ${errorText(error)}`); }
}
