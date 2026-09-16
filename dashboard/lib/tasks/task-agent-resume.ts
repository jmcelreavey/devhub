/**
 * Pure helpers for Resume with Agent + task-row agent-run chips.
 * Orchestration (follow-up vs new dispatch) lives in resume-task-agent.ts.
 */
import type { TaskAgentRunRecord, TaskAgentRunStatus, TaskPrAttention } from "@/lib/tasks/task-agent-runs";
import { buildTaskImplementPrompt, taskImplementPlanUrl } from "@/lib/tasks/implement-prompt";

/** Sidecar statuses where the human can pick work back up. */
export const TASK_AGENT_RESUMABLE_STATUSES = ["paused", "abandoned", "failed"] as const;

export type TaskAgentResumableStatus = (typeof TASK_AGENT_RESUMABLE_STATUSES)[number];

/** Chip kinds shown on the task row (not every sidecar status gets a chip). */
export type TaskAgentChipKind = "running" | "attention" | "merged" | "closed" | "waiting" | "paused" | "ready";

export type TaskAgentChip = {
  kind: TaskAgentChipKind;
  label: string;
  runId: string;
  status: TaskAgentRunStatus;
  /** Tooltip detail (attention summary, PR link). */
  detail?: string;
  prUrl?: string;
};

const ATTENTION_LABEL: Record<TaskPrAttention["kind"], string> = {
  "ci-failing": "CI failing",
  "changes-requested": "Changes requested",
  "new-comments": "New PR comments",
};

export function isTaskAgentResumableStatus(status: string): status is TaskAgentResumableStatus {
  return (TASK_AGENT_RESUMABLE_STATUSES as readonly string[]).includes(status);
}

export function canResumeTaskAgentRun(
  status: string | null | undefined,
  sessionId?: string | null,
): boolean {
  if (!status) return false;
  if (isTaskAgentResumableStatus(status)) return true;
  // Finished successfully but still has a CLI session to continue (e.g. Claude --resume).
  if (status === "done" && Boolean(sessionId?.trim())) return true;
  return false;
}

/** Map latest linked run → chip, or null when nothing useful to show. */
export function taskAgentChipForLatestRun(
  latest:
    | (Pick<TaskAgentRunRecord, "runId" | "status"> &
        Partial<Pick<TaskAgentRunRecord, "prUrl" | "prState" | "attention">> & { sessionId?: string | null })
    | null
    | undefined,
): TaskAgentChip | null {
  if (!latest?.runId) return null;
  const { runId, status, sessionId, prUrl } = latest;
  if (status === "queued" || status === "running") {
    return { kind: "running", label: "Running", runId, status };
  }
  if (latest.attention) {
    return {
      kind: "attention",
      label: ATTENTION_LABEL[latest.attention.kind],
      runId,
      status,
      detail: latest.attention.summary,
      prUrl,
    };
  }
  if (latest.prState === "merged") return { kind: "merged", label: "PR merged", runId, status, prUrl };
  if (latest.prState === "closed") return { kind: "closed", label: "PR closed", runId, status, prUrl };
  if (latest.prState === "open") return { kind: "waiting", label: "PR open", runId, status, prUrl };
  if (status === "paused") {
    return { kind: "paused", label: "Paused", runId, status };
  }
  if (status === "done" && canResumeTaskAgentRun(status, sessionId)) {
    return { kind: "ready", label: "Continue", runId, status };
  }
  if (canResumeTaskAgentRun(status, sessionId)) {
    return { kind: "ready", label: "Ready to resume", runId, status };
  }
  return null;
}

export function agentActivityHrefForRun(runId: string): string {
  return `/agent-activity?run=${encodeURIComponent(runId)}`;
}

export interface BuildTaskAgentResumePromptInput {
  origin: string;
  taskId: string;
  date: string;
  handoff: string;
  repoName?: string;
  cwd?: string;
  jiraKey?: string;
  /** When following up an existing session. */
  priorRunId?: string;
  /** The run's PR needs fixing — the resume is about this, not the original plan. */
  attention?: Pick<TaskPrAttention, "kind" | "summary"> & { prUrl?: string };
  /**
   * Prior Agent Activity notes (interactive agent_interactive_note / result text).
   * Prefer formatAgentActivityTrailForResume so Resume steers from the audit trail.
   */
  activityTrail?: string;
}

/** Max characters of Activity trail injected into a resume prompt. */
const ACTIVITY_TRAIL_MAX = 12_000;

export type ActivityTrailEvent = {
  type: string;
  text?: string;
  ok?: boolean;
};

/**
 * Turn Agent Activity events into a resume-steering block. Keeps text notes and
 * result summaries (the interactive audit trail); drops tool noise.
 */
export function formatAgentActivityTrailForResume(
  events: ActivityTrailEvent[],
  opts?: { maxChars?: number },
): string {
  const max = opts?.maxChars ?? ACTIVITY_TRAIL_MAX;
  const out: string[] = [];
  for (const ev of events) {
    const note = typeof ev.text === "string" ? ev.text.replace(/\r\n/g, "\n").trim() : "";
    if (!note) continue;
    if (ev.type === "text") out.push(`- ${note}`);
    else if (ev.type === "result") out.push(`- [${ev.ok === false ? "failed" : "done"}] ${note}`);
  }
  if (out.length === 0) return "";
  let body = out.join("\n");
  if (body.length > max) {
    body = `…(earlier notes truncated)\n${body.slice(body.length - max)}`;
  }
  return body;
}

/**
 * Prompt injected on resume: plan URL + durable handoff, then the usual
 * implement-task contract so a cold new run still has full context.
 */
export function buildTaskAgentResumePrompt(input: BuildTaskAgentResumePromptInput): string {
  const planUrl = taskImplementPlanUrl(input);
  const base = buildTaskImplementPrompt(input);
  const handoff = input.handoff.replace(/\r\n/g, "\n").trim();
  const lines = [
    "RESUME an in-progress DevHub task — do not start from scratch.",
    `Plan URL (curl it): ${planUrl}`,
  ];
  if (input.priorRunId) lines.push(`Prior agent run: ${input.priorRunId}`);
  if (input.attention) {
    lines.push(
      "",
      `FIX THE PULL REQUEST FIRST${input.attention.prUrl ? ` (${input.attention.prUrl})` : ""}:`,
      `${ATTENTION_LABEL[input.attention.kind]} — ${input.attention.summary}`,
      "Read the full failure or review with gh (gh pr checks / gh pr view --comments), fix it on the same branch, and ask before pushing.",
    );
  }
  if (handoff) {
    lines.push("", "--- durable handoff (source of truth for prior progress) ---", handoff, "--- end handoff ---", "");
  } else {
    lines.push("", "(No durable handoff yet — curl the plan URL and inspect the repo/branch before coding.)", "");
  }
  const trail = input.activityTrail?.replace(/\r\n/g, "\n").trim();
  if (trail) {
    lines.push(
      "--- prior Agent Activity notes (steer from these; they are the audit trail) ---",
      trail,
      "--- end Activity notes ---",
      "",
    );
  } else if (input.priorRunId) {
    lines.push(
      "(No Agent Activity notes on the prior run — curl the plan URL, read the handoff, and inspect the repo/branch before coding.)",
      "",
    );
  }
  lines.push(base);
  return lines.join("\n");
}


/**
 * Map SkillAgentDialog / terminal CLI ids onto agent_dispatch provider ids.
 * "default" is null: which CLI it means lives in the Agent CLI settings, so
 * callers resolve it (resolveTaskImplementationProvider) instead of guessing.
 */
export function mapUiProviderToAgentDispatch(provider: string): string | null {
  const id = provider.trim().toLowerCase();
  if (!id || id === "openchamber" || id === "default") return null;
  if (id === "chatgpt") return "codex";
  return id;
}

/** Reverse of mapUiProviderToAgentDispatch for resume picker preselect. */
export function mapAgentDispatchProviderToUi(provider: string | null | undefined): string {
  const id = (provider ?? "").trim().toLowerCase();
  if (!id) return "default";
  return id === "codex" ? "chatgpt" : id;
}

/**
 * True when Resume should continue the prior CLI session (same provider +
 * supportsResume + a session id), whether via headless dispatch or interactive.
 */
export function willResumeFollowUpSession(opts: {
  priorDispatchProvider?: string | null;
  selectedUiProvider: string;
  priorSessionId?: string | null;
  priorSupportsResume: boolean;
}): boolean {
  if (!opts.priorSupportsResume) return false;
  const session = opts.priorSessionId?.trim();
  if (!session) return false;
  const selected = mapUiProviderToAgentDispatch(opts.selectedUiProvider);
  const prior = (opts.priorDispatchProvider ?? "").trim().toLowerCase();
  if (!selected || !prior) return false;
  return selected === prior;
}

/** Sidecar-safe id for an interactive terminal resume (not agent-run.cjs). */
export function newInteractiveTaskAgentRunId(): string {
  const mid = `term${Date.now().toString(36).slice(-6)}`;
  const bytes = new Uint8Array(4);
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `run-${mid}-${hex}`;
}

