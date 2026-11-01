export const AGENT_STREAM_FORMATS = [
  "claude-stream-json",
  "cursor-stream-json",
  "codex-json",
  "text",
] as const;
export type AgentStreamFormat = (typeof AGENT_STREAM_FORMATS)[number];

export type AgentRunEvent =
  | { type: "session"; sessionId: string; model?: string }
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; input?: string }
  | { type: "tool_result"; ok: boolean; output?: string }
  | { type: "stderr"; text: string }
  | {
      type: "result";
      ok: boolean;
      text?: string;
      costUsd?: number;
      turns?: number;
      durationMs?: number;
    }
  | { type: "error"; message: string };

/** `seq` is the event's line index in events.jsonl — the cursor MCP callers page with. */
export type RecordedAgentRunEvent = AgentRunEvent & { seq: number; ts: number };


export type AgentRunState = "queued" | "starting" | "running" | "needs-attention" | "completed" | "succeeded" | "failed" | "cancelled";

export interface AgentTaskScope {
  profile: string;
  directoryIdentity: string;
  taskCreatedAt: string;
}

export interface CheckoutPreparation {
  originalBranch: string;
  originalHead: string;
  branch: string;
  stashMessage: string;
  stashSha?: string;
  baseSha?: string;
}

export interface AgentActivityContext {
  source: "interactive" | "schedule" | "auto-review" | "investigation" | "briefing" | "generation" | "aionui";
  action: string;
  groupId?: string;
  taskId?: string;
  taskDate?: string;
  taskScope?: AgentTaskScope;
  repoName?: string;
  prUrl?: string;
  headSha?: string;
  jobId?: string;
  occurrence?: number;
  notePath?: string;
  /** Which pass of a step this is ("retry 2", "fix round 1"), appended to the chat title so repeats are told apart. */
  label?: string;
}

export interface AgentRunWorktree {
  path: string;
  branch: string;
  repoRoot: string;
}

export interface AgentRunSpec {
  id: string;
  schemaVersion?: 2;
  /** Records without this field were launched by the legacy terminal runner. */
  /** "aionui" only on records from before Paseo; they load read-only. */
  runtime?: "legacy-cli" | "aionui" | "paseo" | "generation";
  activity?: AgentActivityContext;
  requestId?: string;
  provider: string;
  providerLabel: string;
  /** Absolute binary path, resolved at dispatch so the runner does not depend on the tab's PATH. */
  bin: string;
  args: string[];
  format: AgentStreamFormat;
  cwd: string;
  title: string;
  prompt: string;
  model?: string;
  /**
   * Reasoning effort copied from the HTTP call's provider options.
   * Omitted when the call did not send one.
   */
  reasoningEffort?: string;
  /** Nesting level of the run itself (a run started by a human is 0). */
  depth: number;
  createdAt: number;
  parentRunId?: string;
  /** HEAD when the run was dispatched — the base for `agent_diff`. */
  baseSha?: string;
  worktree?: AgentRunWorktree;
  /** Recovery receipt for a fresh run in the user's checkout, including any saved stash. */
  checkoutPreparation?: CheckoutPreparation;
}

export interface AgentRunStatus {
  state: AgentRunState;
  updatedAt: number;
  eventCount: number;
  proposalId?: string;
  /** Runner (wrapper) pid — signalling it tears down the CLI it spawned. */
  pid?: number;
  /** Observed for recovery only. Never signal the dashboard process to cancel a generation. */
  ownerPid?: number;
  terminalSessionId?: string;
  startedAt?: number;
  finishedAt?: number;
  exitCode?: number | null;
  /** The CLI's own session id, used to resume for follow-ups. */
  sessionId?: string;
  connectionId?: string;
  conversationId?: string;
  messageId?: string;
  steeringMessageIds?: string[];
  turnId?: string;
  connectivity?: "connected" | "reconnecting";
  submissionAttemptedAt?: number;
  cancelRequestedAt?: number;
  /** Set after a PR-review chat is archived in the Paseo sidebar. */
  sidebarArchivedAt?: number;
  /** Paseo workspace DevHub pinned for a task's plan/implement chat. DevHub only unpins its own pins. */
  pinnedWorkspaceId?: string;
  /** Set once that pin is released: implementation started (plans) or the task closed. */
  workspaceUnpinnedAt?: number;
  /**
   * Set while a deferred start is still creating the worktree or the Paseo
   * agent. The chats frame reads it until a conversation id exists.
   */
  startupPhase?: "worktree" | "agent";
  inputTokens?: number;
  outputTokens?: number;
  resultText?: string;
  costUsd?: number;
  turns?: number;
  error?: string;
}


export interface RunEventPage {
  events: RecordedAgentRunEvent[];
  /** Cursor for the next call. Equal to `since` when nothing new arrived. */
  next: number;
  total: number;
}
