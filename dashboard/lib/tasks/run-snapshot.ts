/**
 * Automatic handoff entry for a finished agent run.
 *
 * Agents rarely write a handoff themselves, so Resume used to start from an
 * empty page. When a task-linked run ends — CLI exit, MCP finish, closed tab,
 * cancel — this appends what a fresh agent needs first: the branch, the last
 * commit, how far it is from the base, uncommitted files, and the session to
 * continue. Agent-written notes stay on top; this only appends.
 *
 * Also called from the runner process (scripts/agent-run.ts), so keep imports lean.
 */
import { execFile } from "node:child_process";
import { getNotesDir } from "@/lib/notes/dir";
import {
  getTaskAgentRuns,
  lookupTaskIdForRun,
  patchTaskAgentRun,
  setTaskAgentHandoff,
} from "@/lib/tasks/task-agent-runs";

const GIT_TIMEOUT_MS = 5_000;

export interface RunSnapshot {
  branch?: string;
  /** `abc1234 subject` */
  headCommit?: string;
  /** e.g. `origin/main` */
  base?: string;
  /** `git diff --shortstat base...HEAD`, e.g. `3 files changed, 20 insertions(+)` */
  committedChanges?: string;
  uncommittedFiles: number;
}

export interface RunSnapshotContext {
  runId: string;
  state: string;
  provider?: string;
  exitCode?: number | null;
  sessionId?: string | null;
  error?: string;
  at?: Date;
}

function git(cwd: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      resolve(err ? undefined : stdout.trim() || undefined);
    });
  });
}

export async function collectRunSnapshot(cwd: string): Promise<RunSnapshot> {
  const [branch, headCommit, originHead, status] = await Promise.all([
    git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(cwd, ["log", "-1", "--format=%h %s"]),
    git(cwd, ["rev-parse", "--abbrev-ref", "origin/HEAD"]),
    git(cwd, ["status", "--porcelain"]),
  ]);
  const base = originHead && originHead !== "origin/HEAD" ? originHead : undefined;
  const committedChanges = base ? await git(cwd, ["diff", "--shortstat", `${base}...HEAD`]) : undefined;
  return {
    branch: branch && branch !== "HEAD" ? branch : undefined,
    headCommit,
    base,
    committedChanges,
    uncommittedFiles: status ? status.split("\n").length : 0,
  };
}

/** Heading that marks a run's snapshot — also the dedupe key. */
export function snapshotHeading(runId: string): string {
  return `### Run ${runId}`;
}

export function buildRunSnapshotMarkdown(snapshot: RunSnapshot, ctx: RunSnapshotContext): string {
  const at = (ctx.at ?? new Date()).toISOString().slice(0, 16).replace("T", " ");
  const exit = typeof ctx.exitCode === "number" ? ` (exit ${ctx.exitCode})` : "";
  const lines = [`${snapshotHeading(ctx.runId)} — ${ctx.state}${exit} · ${at} UTC`];
  if (ctx.provider) lines.push(`- CLI: ${ctx.provider}`);
  if (snapshot.branch) {
    lines.push(`- Branch: \`${snapshot.branch}\`${snapshot.headCommit ? ` at ${snapshot.headCommit}` : ""}`);
  }
  if (snapshot.base) {
    lines.push(`- Changes vs ${snapshot.base}: ${snapshot.committedChanges ?? "none committed"}`);
  }
  lines.push(
    snapshot.uncommittedFiles > 0
      ? `- Uncommitted: ${snapshot.uncommittedFiles} file(s) — inspect before continuing`
      : "- Working tree clean",
  );
  if (ctx.error) lines.push(`- Stopped because: ${ctx.error}`);
  if (ctx.sessionId) lines.push(`- Continue with CLI session \`${ctx.sessionId}\``);
  return lines.join("\n");
}

/**
 * Append the snapshot for a task-linked run (once per run) and remember the
 * branch + checkout so the PR watcher can find its pull request.
 */
export async function recordRunSnapshot(
  cwd: string,
  ctx: RunSnapshotContext,
  // Resolved once, before any await: callers fire this and move on, and the
  // environment can change underneath (tests reset NOTES_DIR) — the check and
  // the write must hit the same vault.
  notesDir = getNotesDir(),
): Promise<boolean> {
  const taskId = lookupTaskIdForRun(ctx.runId, notesDir);
  if (!taskId || !cwd) return false;
  const heading = `${snapshotHeading(ctx.runId)} `;
  if (getTaskAgentRuns(taskId, notesDir).handoff.includes(heading)) return false;
  const snapshot = await collectRunSnapshot(cwd);
  // Re-check after the git calls: another finish path may have written it meanwhile.
  if (getTaskAgentRuns(taskId, notesDir).handoff.includes(heading)) return false;
  await setTaskAgentHandoff(taskId, buildRunSnapshotMarkdown(snapshot, ctx), { mode: "append", notesDir });
  await patchTaskAgentRun(
    taskId,
    ctx.runId,
    { cwd, ...(snapshot.branch ? { branch: snapshot.branch } : {}) },
    notesDir,
  );
  return true;
}
