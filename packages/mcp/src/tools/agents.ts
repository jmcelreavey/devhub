import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { agentCancel, agentDiff, agentDispatch, agentFollowup, agentInteractiveFinish, agentInteractiveNote, agentOutput, agentProviders, agentRace, agentRuns, agentWait } from "../../../../packages/shared/actions/agents.ts";
import { registerAction } from "../actions/register.ts";
import type { Context } from "../context.ts";
import { requestAction, withDashboardErrors, type DashboardClient, type DashboardToolResult } from "../dashboard-client.ts";

/**
 * Agent dispatch: hand work to another coding agent CLI (Claude Code, Cursor,
 * Codex, Gemini, OpenCode, Antigravity, or any custom CLI) and follow it.
 *
 * Runs execute with approvals disabled in a DevHub terminal tab the user can
 * watch and stop. Without `worktree` they edit the real checkout, so changes
 * land in the user's IDE as they happen. The dashboard owns run state
 * (/api/agent/runs); these tools are a thin client over it.
 */

type AgentRunState = "queued" | "starting" | "running" | "needs-attention" | "completed" | "succeeded" | "failed" | "cancelled";

export interface AgentRunSummary {
  id: string;
  provider: string;
  providerLabel: string;
  title: string;
  model: string | null;
  reasoningEffort?: string | null;
  state: AgentRunState;
  runtime?: "legacy-cli" | "aionui" | "paseo" | "generation";
  conversationId?: string | null;
  cwd: string;
  worktree: { path: string; branch: string; repoRoot: string } | null;
  parentRunId: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  exitCode: number | null;
  eventCount: number;
  sessionId: string | null;
  terminalSessionId: string | null;
  resultText: string | null;
  costUsd: number | null;
  turns: number | null;
  error: string | null;
}

export type AgentRunEvent = { seq: number; ts: number } & (
  | { type: "session"; sessionId: string; model?: string }
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; input?: string }
  | { type: "tool_result"; ok: boolean; output?: string }
  | { type: "stderr"; text: string }
  | { type: "result"; ok: boolean; text?: string; costUsd?: number; turns?: number; durationMs?: number }
  | { type: "error"; message: string }
);

interface RunPage {
  run: AgentRunSummary;
  events: AgentRunEvent[];
  next: number;
  total: number;
}

interface AgentDiffValue {
  cwd: string;
  baseSha: string | null;
  stat: string;
  patch: string | null;
  untracked: string[];
  truncated: boolean;
  note: string | null;
}

interface ProviderInfo {
  id: string;
  label: string;
  installed: boolean;
  supportsResume: boolean;
  supportsMaxTurns: boolean;
  custom: boolean;
}

const POLL_MS = 1_500;
const WAIT_EVENTS_SHOWN = 200;

function isActive(state: AgentRunState): boolean {
  return state === "queued" || state === "starting" || state === "running" || state === "needs-attention";
}

/** Nesting level of this server's caller — DevHub sets it on every agent it dispatches through Paseo. */
export function callerDepth(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt(env.DEVHUB_AGENT_DEPTH ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function formatAgentEvent(event: AgentRunEvent): string {
  const at = `[${event.seq}]`;
  switch (event.type) {
    case "session":
      return `${at} session ${event.sessionId}${event.model ? ` (${event.model})` : ""}`;
    case "text":
      return `${at} ${event.text}`;
    case "tool_call":
      return `${at} → ${event.name}${event.input ? ` ${event.input}` : ""}`;
    case "tool_result":
      return `${at}   ${event.ok ? "ok" : "FAILED"}${event.output ? `: ${event.output}` : ""}`;
    case "stderr":
      return `${at} stderr: ${event.text}`;
    case "result":
      return `${at} result: ${event.ok ? "ok" : "error"}`;
    case "error":
      return `${at} ERROR: ${event.message}`;
  }
}

function recordedModelLabel(model: string | null, reasoningEffort?: string | null): string {
  const detail = [model, reasoningEffort].filter(Boolean).join(" · ");
  return detail ? ` (${detail})` : "";
}

export function formatRunSummary(run: AgentRunSummary): string {
  const stats = [
    run.turns !== null ? `${run.turns} turns` : null,
    run.costUsd !== null ? `$${run.costUsd.toFixed(4)}` : null,
    run.exitCode !== null ? `exit ${run.exitCode}` : null,
  ].filter(Boolean);
  const lines = [
    `${run.id} · ${run.providerLabel}${recordedModelLabel(run.model, run.reasoningEffort)} · ${run.state.toUpperCase()}`,
    `Title: ${run.title}`,
    `Cwd: ${run.cwd}`,
    run.worktree ? `Worktree: ${run.worktree.path} (branch ${run.worktree.branch})` : null,
    run.parentRunId ? `Follow-up of: ${run.parentRunId}` : null,
    stats.length ? `Stats: ${stats.join(" · ")}` : null,
    run.terminalSessionId ? `Terminal session: ${run.terminalSessionId}` : null,
    run.conversationId ? `Conversation: ${run.conversationId}` : null,
    run.state === "needs-attention" ? "Waiting for your attention in the agent conversation." : null,
    run.state === "completed" ? "The reply is available; this runtime does not report a verified success reason." : null,
    run.state === "queued" && (!run.runtime || run.runtime === "legacy-cli")
      ? "Waiting for the DevHub terminal dock to open its tab — the dashboard must be open in a browser or the desktop app."
      : null,
    run.error ? `Error: ${run.error}` : null,
    !isActive(run.state) && run.resultText ? `Result:\n${run.resultText}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

function text(value: string, isError = false) {
  return { content: [{ type: "text" as const, text: value }], ...(isError ? { isError } : {}) };
}

function fetchRunPage(dashboard: DashboardClient, runId: string, since: number, limit: number): Promise<RunPage> {
  return requestAction<RunPage>(dashboard, agentOutput.http, { pathParams: { id: runId }, query: { since, limit } });
}

function renderEvents(events: AgentRunEvent[], from: number, next: number, total: number): string {
  if (events.length === 0) return `No new events since ${from}. Next cursor: since=${next}`;
  const more = next < total ? `\nMore events available — call again with since=${next}.` : `\nNext cursor: since=${next}`;
  return `Events ${from}–${next - 1} of ${total}:\n${events.map(formatAgentEvent).join("\n")}${more}`;
}

export function registerAgentTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  registerAction(
    server, agentProviders,
    { read: () => requestAction<{ providers: ProviderInfo[]; providersConfigError: string | null }>(dashboard, agentRuns.http, { query: { limit: 1 } }) },
    (result) => text(result),
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
    { omitInputSchema: true },
  );

  registerAction(
    server, agentDispatch,
    { dispatch: async (input) => ({
      status: 201,
      body: await requestAction<{ run: AgentRunSummary }>(dashboard, agentDispatch.http, { body: {
        ...input,
        depth: callerDepth(),
      } }),
    }) },
    ({ body }) => {
      const { run } = body as { run: AgentRunSummary };
      return text(
        [
          `Dispatched ${run.id} to ${run.providerLabel}.`,
          formatRunSummary(run),
          "",
          `Next: agent_wait(runId="${run.id}") to block until it finishes, or agent_output(runId="${run.id}") to page events.`,
        ].join("\n"),
      );
    },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, agentRace,
    { dispatch: async (input) => (await requestAction<{ run: AgentRunSummary }>(dashboard, agentDispatch.http, { body: { ...input, worktree: true, depth: callerDepth() } })).run },
    (result) => text(result.text, result.isError),
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, agentRuns,
    { read: (limit) => requestAction<{ runs: AgentRunSummary[] }>(dashboard, agentRuns.http, { query: { limit: limit ?? 20 } }) },
    (value) => {
      const data = value as { runs: AgentRunSummary[] };
      if (data.runs.length === 0) return text("No agent runs yet. Start one with agent_dispatch.");
      const lines = data.runs.map(
        (run) => `- ${run.id} · ${run.providerLabel} · ${run.state}${run.parentRunId ? " · follow-up" : ""} · ${run.title}${run.error ? ` — ${run.error}` : ""}`,
      );
      return text(`Agent runs (${data.runs.length}):\n${lines.join("\n")}`);
    },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, agentOutput,
    { read: ({ runId, since, limit }) => fetchRunPage(dashboard, runId, since ?? 0, limit ?? 200) },
    ({ page: value, from }) => {
      const page = value as RunPage;
      return text(`${formatRunSummary(page.run)}\n\n${renderEvents(page.events, from, page.next, page.total)}`);
    },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, agentWait,
    { wait: async ({ runId, since, until, timeoutSeconds }, request) => {
        const from = since ?? 0;
        const deadline = Date.now() + (timeoutSeconds ?? 120) * 1_000;
        const collected: AgentRunEvent[] = [];
        let cursor = from;

        for (;;) {
          const page = await fetchRunPage(dashboard, runId, cursor, 500);
          if (page.events.length > 0) {
            collected.push(...page.events);
            cursor = page.next;
            if (request?.progressToken !== undefined) {
              const last = page.events[page.events.length - 1];
              await request.notify(cursor, last ? formatAgentEvent(last).slice(0, 200) : undefined);
            }
          }
          const caughtUp = cursor >= page.total;
          const done = !isActive(page.run.state) && caughtUp;
          const active = until === "activity" && collected.length > 0;
          const timedOut = Date.now() >= deadline;

          if (done || active || timedOut || request?.signal.aborted) {
            const shown = collected.slice(-WAIT_EVENTS_SHOWN);
            const omitted = collected.length - shown.length;
            const header = done
              ? `Run ${page.run.state}.`
              : active
                ? "New activity."
                : `Still ${page.run.state} after ${timeoutSeconds ?? 120}s — call agent_wait again with since=${cursor}.`;
            const events = shown.length
              ? `${omitted > 0 ? `(${omitted} earlier events omitted — agent_output since=${from})\n` : ""}${shown.map(formatAgentEvent).join("\n")}`
              : "No new events.";
            return `${header}\n\n${formatRunSummary(page.run)}\n\n${events}\n\nNext cursor: since=${cursor}`;
          }
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
    } },
    (value) => text(value),
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
    { contextForRequest: (context, extra) => ({
      ...context,
      request: {
        signal: extra.signal,
        progressToken: extra._meta?.progressToken,
        notify: (progress: number, message?: string) => extra.sendNotification({
          method: "notifications/progress",
          params: { progressToken: extra._meta!.progressToken!, progress, message },
        }),
      },
    }) },
  );

  registerAction(
    server, agentFollowup,
    { resume: async ({ runId, ...input }) => ({
      status: 201,
      body: await requestAction<{ run: AgentRunSummary }>(dashboard, agentFollowup.http, { pathParams: { id: runId }, body: { ...input, depth: callerDepth() } }),
    }) },
    ({ body }) => {
      const { run } = body as { run: AgentRunSummary };
      return text(`Follow-up ${run.id} dispatched.\n${formatRunSummary(run)}`);
    },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, agentCancel,
    { cancel: async (runId) => ({
      status: 200,
      body: await requestAction<{ run: AgentRunSummary; outcome: string }>(dashboard, agentCancel.http, { pathParams: { id: runId } }),
    }) },
    ({ body }) => {
      const { run, outcome } = body as { run: AgentRunSummary; outcome: string };
      const said =
        outcome === "signalled"
          ? "Stop signal sent — the run records itself as cancelled once the CLI exits."
          : outcome === "cancelled"
            ? "Cancelled before it started."
            : "Already finished; nothing to stop.";
      return text(`${said}\n${formatRunSummary(run)}`);
    },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, agentInteractiveNote,
    { note: ({ runId, text: note }) => requestAction<{ run: AgentRunSummary }>(dashboard, agentInteractiveNote.http, { pathParams: { id: runId }, body: { text: note } }) },
    ({ run }) => text(`Noted on ${(run as AgentRunSummary).id}.\n${formatRunSummary(run as AgentRunSummary)}`),
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, agentInteractiveFinish,
    { finish: ({ runId, ...input }) => requestAction<{ run: AgentRunSummary }>(dashboard, agentInteractiveFinish.http, { pathParams: { id: runId }, body: input }) },
    ({ run }) => text(`Interactive run ${(run as AgentRunSummary).state}.\n${formatRunSummary(run as AgentRunSummary)}`),
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, agentDiff,
    { diff: async ({ runId, patch }) => ({
      status: 200,
      body: { runId, ...await requestAction<{ diff: AgentDiffValue }>(dashboard, agentDiff.http, { pathParams: { id: runId }, query: { patch: patch === false ? 0 : 1 } }) },
    }) },
    ({ body }) => {
      const { runId, diff } = body as { runId: string; diff: AgentDiffValue };
      const parts = [
        `Diff for ${runId} in ${diff.cwd}${diff.baseSha ? ` against ${diff.baseSha.slice(0, 12)}` : ""}`,
        diff.note,
        diff.stat ? `\n${diff.stat}` : "\nNo tracked changes.",
        diff.untracked.length ? `\nUntracked:\n${diff.untracked.map((file) => `- ${file}`).join("\n")}` : null,
        diff.patch ? `\n\`\`\`diff\n${diff.patch}\n\`\`\`` : null,
        diff.truncated ? "(patch truncated)" : null,
      ];
      return text(parts.filter(Boolean).join("\n"));
    },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );
}
