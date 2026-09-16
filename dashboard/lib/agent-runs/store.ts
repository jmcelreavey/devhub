/**
 * Agent run registry: create, read, list, reconcile and cancel runs.
 *
 * The files in each run dir are the source of truth (run-files.ts). This module
 * adds the dashboard's side: where runs live, and correcting a status the
 * runner could not write itself — a tab closed mid-run, a run the dock never
 * picked up.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clip } from "@/lib/agent-runs/events";
import {
  isActiveAgentRunState,
  readRunSpec,
  readRunStatus,
  writeRunSpec,
  writeRunStatus,
  appendRunEvent,
  type AgentRunSpec,
  type AgentRunStatus,
} from "@/lib/agent-runs/run-files";
import { agentConsentFile, hasConsented, recordConsent } from "@/lib/agent-runs/consent";
import { getTerminalProposal, resolveTerminalProposal } from "@/lib/terminal-proposals";
import { syncTaskAgentRunFromAgentState } from "@/lib/tasks/task-agent-runs";

/** Finished runs older than this are pruned whenever a new run is created. */
const RUN_TTL_MS = 3 * 24 * 60 * 60 * 1_000;
/** Proposals expire after 15 minutes, so a run still queued past this never started. */
const NEVER_STARTED_MS = 16 * 60 * 1_000;
const RUN_ID_RE = /^run-[a-z0-9]{6,12}-[0-9a-f]{8}$/;

export interface AgentRun {
  spec: AgentRunSpec;
  status: AgentRunStatus;
  dir: string;
}

/** Transient like terminal logs — the OS temp dir unless overridden. */
export function agentRunsDir(): string {
  return process.env.DEVHUB_AGENT_RUNS_DIR?.trim() || path.join(os.tmpdir(), "devhub-agent-runs");
}

export function newAgentRunId(): string {
  return `run-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

export function isValidAgentRunId(id: string): boolean {
  return RUN_ID_RE.test(id);
}

/** Absolute run dir, or null for a malformed id (guards path traversal). */
export function agentRunDir(id: string): string | null {
  return isValidAgentRunId(id) ? path.join(agentRunsDir(), id) : null;
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function pruneFinishedRuns(root: string): void {
  const now = Date.now();
  for (const name of safeReaddir(root)) {
    if (!isValidAgentRunId(name)) continue;
    const dir = path.join(root, name);
    const status = readRunStatus(dir);
    if (status && isActiveAgentRunState(status.state)) continue;
    if (now - (status?.updatedAt ?? 0) < RUN_TTL_MS) continue;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function createAgentRun(spec: AgentRunSpec): AgentRun {
  const dir = agentRunDir(spec.id);
  if (!dir) throw new Error(`Invalid agent run id: ${spec.id}`);
  const root = path.dirname(dir);
  // 0700: specs hold prompts and events hold whatever the agent read.
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  pruneFinishedRuns(root);
  fs.mkdirSync(dir, { mode: 0o700 });
  writeRunSpec(dir, spec);
  const status = writeRunStatus(dir, { state: "queued", updatedAt: Date.now(), eventCount: 0 });
  return { spec, status, dir };
}

/**
 * Register an interactive CLI session (Claude/etc in the dock) so Agent Activity
 * lists it without spawning agent-run.cjs. Stays queued until the tab's
 * `--interactive-start` records the shell pid (see interactive-shell.ts); from
 * then on the normal dead-pid and never-started reconcile applies.
 */
export function createInteractiveAgentRun(input: {
  id: string;
  provider: string;
  providerLabel: string;
  cwd: string;
  title: string;
  prompt: string;
  model?: string;
  sessionId?: string;
  parentRunId?: string;
}): AgentRun {
  const now = Date.now();
  const run = createAgentRun({
    id: input.id,
    provider: input.provider,
    providerLabel: input.providerLabel,
    bin: "interactive",
    args: [],
    format: "text",
    cwd: input.cwd,
    title: input.title.slice(0, 80),
    prompt: input.prompt,
    model: input.model,
    depth: 0,
    createdAt: now,
    parentRunId: input.parentRunId,
  });
  return input.sessionId ? updateAgentRunStatus(run, { sessionId: input.sessionId }) : run;
}

function syncLinkedTaskAgentRun(run: AgentRun, status: AgentRunStatus): void {
  // Runner process writes status.json directly; dashboard paths sync here.
  void syncTaskAgentRunFromAgentState(run.spec.id, status.state, {
    sessionId: status.sessionId ?? null,
    terminalSessionId: status.terminalSessionId ?? null,
    provider: run.spec.provider,
  }).catch(() => undefined);
}

export function updateAgentRunStatus(run: AgentRun, patch: Partial<AgentRunStatus>): AgentRun {
  // Re-read first: the runner writes status.json from its own process.
  const current = readRunStatus(run.dir) ?? run.status;
  const status = writeRunStatus(run.dir, { ...current, ...patch });
  syncLinkedTaskAgentRun(run, status);
  return { ...run, status };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function reconcileAgentRun(run: AgentRun): AgentRun {
  const { status } = run;
  const now = Date.now();
  // The dock chip approved (or already injected) this run's proposal: that is
  // the user saying "this agent may work in this repo" — remember it so later
  // dispatches to the same provider+repo auto-run (see consent.ts).
  if (status.proposalId && (status.state === "running" || status.state === "succeeded")) {
    try {
      // Reconcile runs on every list/poll — only write the first time.
      const file = agentConsentFile();
      const repoKey = run.spec.worktree?.repoRoot ?? run.spec.cwd;
      if (!hasConsented(file, run.spec.provider, repoKey)) recordConsent(file, run.spec.provider, repoKey, now);
    } catch {
      // Consent recording must never break reconciliation.
    }
  }
  if (status.state === "running" && status.pid && !pidAlive(status.pid)) {
    // Interactive runs track the tab's shell: it dying means the tab was closed.
    return updateAgentRunStatus(
      run,
      run.spec.bin === "interactive"
        ? { state: "cancelled", finishedAt: now, error: status.error ?? "Terminal tab closed before the CLI exited." }
        : {
            state: "failed",
            finishedAt: now,
            error: status.error ?? "The runner exited without reporting a result — was the terminal tab closed?",
          },
    );
  }
  if (status.state !== "queued") return run;

  const proposal = status.proposalId ? getTerminalProposal(status.proposalId) : null;
  if (proposal?.status === "denied") {
    return updateAgentRunStatus(run, { state: "cancelled", finishedAt: now, error: "Denied in the DevHub terminal dock." });
  }
  if (proposal?.status === "expired" || proposal?.status === "failed") {
    return updateAgentRunStatus(run, {
      state: "failed",
      finishedAt: now,
      error: proposal.error ?? `Terminal proposal ${proposal.status}.`,
    });
  }
  if (!proposal && now - run.spec.createdAt > NEVER_STARTED_MS) {
    return updateAgentRunStatus(run, {
      state: "failed",
      finishedAt: now,
      error: "Never started — the DevHub terminal dock did not pick the run up. Is the dashboard open?",
    });
  }
  return run;
}

function readRunFromDir(dir: string): AgentRun | null {
  const spec = readRunSpec(dir);
  const status = readRunStatus(dir);
  return spec && status ? { spec, status, dir } : null;
}

export function readAgentRun(id: string): AgentRun | null {
  const dir = agentRunDir(id);
  if (!dir) return null;
  const run = readRunFromDir(dir);
  if (!run) return null;
  const reconciled = reconcileAgentRun(run);
  // Heal task sidecar when status.json already shows a terminal state.
  if (!isActiveAgentRunState(reconciled.status.state)) {
    syncLinkedTaskAgentRun(reconciled, reconciled.status);
  }
  return reconciled;
}

/** Newest first. */
export function listAgentRuns(limit = 20): AgentRun[] {
  const root = agentRunsDir();
  const runs = safeReaddir(root)
    .filter(isValidAgentRunId)
    .map((name) => readRunFromDir(path.join(root, name)))
    .filter((run): run is AgentRun => run !== null);
  return runs
    .sort((a, b) => b.spec.createdAt - a.spec.createdAt)
    .slice(0, limit)
    .map(reconcileAgentRun);
}

export function countActiveAgentRuns(): number {
  return listAgentRuns(Number.MAX_SAFE_INTEGER).filter((run) => isActiveAgentRunState(run.status.state)).length;
}

export type AgentRunCancelOutcome = "signalled" | "cancelled" | "already-finished";

/**
 * A running run is signalled and records "cancelled" itself when the CLI exits;
 * a queued one is denied in the dock and marked cancelled here.
 */
export function cancelAgentRun(run: AgentRun): { run: AgentRun; outcome: AgentRunCancelOutcome } {
  const { status } = run;
  // Interactive runs' pid is the user's shell — never signal it; just close the record.
  if (status.state === "running" && run.spec.bin === "interactive") {
    return {
      run: updateAgentRunStatus(run, {
        state: "cancelled",
        finishedAt: Date.now(),
        error: "Cancelled while the interactive CLI was still open.",
      }),
      outcome: "cancelled",
    };
  }
  if (status.state === "running" && status.pid) {
    try {
      process.kill(status.pid, "SIGTERM");
      return { run, outcome: "signalled" };
    } catch {
      return { run: reconcileAgentRun(run), outcome: "already-finished" };
    }
  }
  if (status.state === "queued") {
    if (status.proposalId) resolveTerminalProposal(status.proposalId, "deny");
    return {
      run: updateAgentRunStatus(run, { state: "cancelled", finishedAt: Date.now(), error: "Cancelled before it started." }),
      outcome: "cancelled",
    };
  }
  return { run, outcome: "already-finished" };
}

export function appendInteractiveAgentNote(run: AgentRun, text: string): AgentRun {
  const trimmed = clip(text, 8_000).trim();
  if (!trimmed) return run;
  const page = { type: "text" as const, text: trimmed, seq: run.status.eventCount, ts: Date.now() };
  appendRunEvent(run.dir, page);
  return updateAgentRunStatus(run, { eventCount: run.status.eventCount + 1, updatedAt: Date.now() });
}

export function finishInteractiveAgentRun(
  run: AgentRun,
  input: {
    ok: boolean;
    resultText?: string;
    sessionId?: string;
    error?: string;
  },
): AgentRun {
  const now = Date.now();
  if (input.resultText?.trim()) {
    appendRunEvent(run.dir, {
      type: "result",
      ok: input.ok,
      text: clip(input.resultText.trim(), 8_000),
      seq: run.status.eventCount,
      ts: now,
    });
  }
  const eventBump = input.resultText?.trim() ? 1 : 0;
  return updateAgentRunStatus(run, {
    state: input.ok ? "succeeded" : "failed",
    finishedAt: now,
    updatedAt: now,
    eventCount: run.status.eventCount + eventBump,
    resultText: input.resultText?.trim() || run.status.resultText,
    sessionId: input.sessionId?.trim() || run.status.sessionId,
    error: input.ok ? undefined : input.error?.trim() || run.status.error || "Interactive run marked failed",
    exitCode: input.ok ? 0 : 1,
  });
}

export function toAgentRunSummary(run: AgentRun) {
  const { spec, status } = run;
  return {
    id: spec.id,
    provider: spec.provider,
    providerLabel: spec.providerLabel,
    title: spec.title,
    model: spec.model ?? null,
    state: status.state,
    cwd: spec.cwd,
    worktree: spec.worktree ?? null,
    parentRunId: spec.parentRunId ?? null,
    depth: spec.depth,
    createdAt: spec.createdAt,
    startedAt: status.startedAt ?? null,
    finishedAt: status.finishedAt ?? null,
    exitCode: status.exitCode ?? null,
    eventCount: status.eventCount,
    sessionId: status.sessionId ?? null,
    terminalSessionId: status.terminalSessionId ?? null,
    resultText: status.resultText ? clip(status.resultText, 4_000) : null,
    costUsd: status.costUsd ?? null,
    turns: status.turns ?? null,
    error: status.error ?? null,
  };
}

export type AgentRunSummary = ReturnType<typeof toAgentRunSummary>;
