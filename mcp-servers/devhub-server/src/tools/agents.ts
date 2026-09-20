import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { withDashboardErrors, type DashboardClient } from "../dashboard-client.ts";

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
  state: AgentRunState;
  runtime?: "legacy-cli" | "aionui" | "generation";
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

/** Nesting level of this server's caller — the agent runner sets it for dispatched runs. */
export function callerDepth(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt(env.DEVHUB_AGENT_DEPTH ?? "", 10);
  return Math.max(Number.isFinite(n) && n > 0 ? n : 0, env.AIONUI_CONVERSATION_ID ? 1 : 0);
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

export function formatRunSummary(run: AgentRunSummary): string {
  const stats = [
    run.turns !== null ? `${run.turns} turns` : null,
    run.costUsd !== null ? `$${run.costUsd.toFixed(4)}` : null,
    run.exitCode !== null ? `exit ${run.exitCode}` : null,
  ].filter(Boolean);
  const lines = [
    `${run.id} · ${run.providerLabel}${run.model ? ` (${run.model})` : ""} · ${run.state.toUpperCase()}`,
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
  return dashboard.get<RunPage>(`/api/agent/runs/${encodeURIComponent(runId)}`, { since, limit });
}

function renderEvents(events: AgentRunEvent[], from: number, next: number, total: number): string {
  if (events.length === 0) return `No new events since ${from}. Next cursor: since=${next}`;
  const more = next < total ? `\nMore events available — call again with since=${next}.` : `\nNext cursor: since=${next}`;
  return `Events ${from}–${next - 1} of ${total}:\n${events.map(formatAgentEvent).join("\n")}${more}`;
}

const runIdSchema = z.string().regex(/^run-[a-z0-9-]+$/, "a run id from agent_dispatch or agent_runs");

export function registerAgentTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  server.registerTool(
    "agent_providers",
    {
      description:
        "List enabled AionUi assistants, their readiness and supported controls. Configure native harnesses and custom assistants in Agents. Requires DevHub and its connected AionUi workspace (MCP servers must be enabled — reconnect Agents after Sync MCP).",
    },
    async () =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<{ providers: ProviderInfo[]; providersConfigError: string | null }>(
          "/api/agent/runs",
          { limit: 1 },
        );
        const lines = data.providers.map((p) => {
          const caps = [p.supportsResume ? "follow-ups" : null, p.supportsMaxTurns ? "maxTurns" : null, p.custom ? "custom" : null]
            .filter(Boolean)
            .join(", ");
          return `- ${p.id} (${p.label}): ${p.installed ? "installed" : "NOT installed"}${caps ? ` · ${caps}` : ""}`;
        });
        return text(
          [
            "Agent providers:",
            ...lines,
            data.providersConfigError ? `\nCustom provider config error: ${data.providersConfigError}` : null,
            "\nConfigure agents in AionUi's Assistants view. Use only advertised models and controls.",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }),
  );

  server.registerTool(
    "agent_dispatch",
    {
      description:
        "Start a task in a new AionUi conversation. Defaults to Cursor + Grok with YOLO (auto-approve) unless you pass provider/model. No terminal or window opens. An isolated git worktree is the default; worktree:false uses cwd directly. Returns a durable run and conversation ID. Follow with agent_wait or agent_output; approvals remain in Agents. Reuse requestId when retrying the same submission to avoid duplicate work. Native turn/time/usage limits are available only when the runtime advertises them.",
      inputSchema: {
        requestId: z.string().min(1).max(200).optional().describe("Stable key for retries of this same submission"),
        provider: z.string().min(1).describe("Provider id from agent_providers, e.g. claude, cursor, codex"),
        prompt: z.string().min(1).max(32_000).describe("The full task. The agent has no other context from you."),
        cwd: z.string().min(1).describe("Absolute directory under the user's home — usually a repo root"),
        title: z.string().max(80).optional().describe("Short label for the terminal tab"),
        model: z.string().max(120).optional().describe("Provider-specific model id"),
        worktree: z.boolean().optional().describe("Isolated git worktree on a new branch (default false)"),
        maxTurns: z.number().int().min(1).max(500).optional().describe("Turn cap, for providers that support it"),
      },
    },
    async (input) =>
      withDashboardErrors(async () => {
        const { run } = await dashboard.post<{ run: AgentRunSummary }>("/api/agent/runs", {
          ...input,
          depth: callerDepth(),
        });
        return text(
          [
            `Dispatched ${run.id} to ${run.providerLabel}.`,
            formatRunSummary(run),
            "",
            `Next: agent_wait(runId="${run.id}") to block until it finishes, or agent_output(runId="${run.id}") to page events.`,
          ].join("\n"),
        );
      }),
  );

  server.registerTool(
    "agent_race",
    {
      description:
        "Send the same task to 2–4 AionUi assistants, each in its own worktree and conversation. Each conversation uses YOLO permissions. Compare results with agent_diff; no terminal or window opens.",
      inputSchema: {
        providers: z.array(z.string().min(1)).min(2).max(4).describe("Distinct provider ids"),
        prompt: z.string().min(1).max(32_000),
        cwd: z.string().min(1).describe("Absolute path inside a git repository"),
        title: z.string().max(60).optional(),
        maxTurns: z.number().int().min(1).max(500).optional(),
      },
    },
    async ({ providers, prompt, cwd, title, maxTurns }) =>
      withDashboardErrors(async () => {
        const unique = [...new Set(providers)];
        if (unique.length < 2) return text("agent_race needs at least two distinct providers.", true);
        const lines: string[] = [];
        for (const provider of unique) {
          try {
            const { run } = await dashboard.post<{ run: AgentRunSummary }>("/api/agent/runs", {
              provider,
              prompt,
              cwd,
              title: title ? `${title} (${provider})` : undefined,
              maxTurns,
              worktree: true,
              depth: callerDepth(),
            });
            lines.push(`- ${provider}: ${run.id} → ${run.worktree?.branch ?? run.cwd}`);
          } catch (err) {
            lines.push(`- ${provider}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        return text(
          [
            "Race dispatched:",
            ...lines,
            "",
            "agent_wait each run, then agent_diff each to compare. Worktrees live under the repo's .git/devhub-worktrees/.",
          ].join("\n"),
        );
      }),
  );

  server.registerTool(
    "agent_runs",
    {
      description: "List recent agent runs (newest first) with their state. Requires the dashboard running.",
      inputSchema: { limit: z.number().int().min(1).max(100).optional() },
    },
    async ({ limit }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<{ runs: AgentRunSummary[] }>("/api/agent/runs", { limit: limit ?? 20 });
        if (data.runs.length === 0) return text("No agent runs yet. Start one with agent_dispatch.");
        const lines = data.runs.map(
          (r) =>
            `- ${r.id} · ${r.providerLabel} · ${r.state}${r.parentRunId ? " · follow-up" : ""} · ${r.title}${r.error ? ` — ${r.error}` : ""}`,
        );
        return text(`Agent runs (${data.runs.length}):\n${lines.join("\n")}`);
      }),
  );

  server.registerTool(
    "agent_output",
    {
      description:
        "Read an agent run's status and its events (text, tool calls, results) from a cursor. Returns immediately; pass the returned cursor as `since` next time. Requires the dashboard running.",
      inputSchema: {
        runId: runIdSchema,
        since: z.number().int().min(0).optional().describe("Event cursor (default 0)"),
        limit: z.number().int().min(1).max(500).optional().describe("Max events (default 200)"),
      },
    },
    async ({ runId, since, limit }) =>
      withDashboardErrors(async () => {
        const from = since ?? 0;
        const page = await fetchRunPage(dashboard, runId, from, limit ?? 200);
        return text(`${formatRunSummary(page.run)}\n\n${renderEvents(page.events, from, page.next, page.total)}`);
      }),
  );

  server.registerTool(
    "agent_wait",
    {
      description:
        "Block until an agent run finishes (or, with until=activity, until it emits new events), up to timeoutSeconds. Sends MCP progress notifications while waiting when the client asks for them. On timeout, call again with the returned cursor. Requires the dashboard running.",
      inputSchema: {
        runId: runIdSchema,
        since: z.number().int().min(0).optional().describe("Event cursor to collect from (default 0)"),
        until: z.enum(["finished", "activity"]).optional().describe("Default finished"),
        // Under the 360s toolTimeoutSec harnesses get from mcp/shared/devhub.json.
        timeoutSeconds: z.number().int().min(1).max(300).optional().describe("Default 120, max 300"),
      },
    },
    async ({ runId, since, until, timeoutSeconds }, extra) =>
      withDashboardErrors(async () => {
        const from = since ?? 0;
        const deadline = Date.now() + (timeoutSeconds ?? 120) * 1_000;
        const progressToken = extra._meta?.progressToken;
        const collected: AgentRunEvent[] = [];
        let cursor = from;

        for (;;) {
          const page = await fetchRunPage(dashboard, runId, cursor, 500);
          if (page.events.length > 0) {
            collected.push(...page.events);
            cursor = page.next;
            if (progressToken !== undefined) {
              const last = page.events[page.events.length - 1];
              await extra.sendNotification({
                method: "notifications/progress",
                params: { progressToken, progress: cursor, message: last ? formatAgentEvent(last).slice(0, 200) : undefined },
              });
            }
          }
          const caughtUp = cursor >= page.total;
          const done = !isActive(page.run.state) && caughtUp;
          const active = until === "activity" && collected.length > 0;
          const timedOut = Date.now() >= deadline;

          if (done || active || timedOut || extra.signal.aborted) {
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
            return text(`${header}\n\n${formatRunSummary(page.run)}\n\n${events}\n\nNext cursor: since=${cursor}`);
          }
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
      }),
  );

  server.registerTool(
    "agent_followup",
    {
      description:
        "Continue a finished agent run: starts a new run that resumes the same CLI session in the same cwd/worktree (providers with follow-up support only). Requires the dashboard running.",
      inputSchema: {
        runId: runIdSchema,
        prompt: z.string().min(1).max(32_000),
        model: z.string().max(120).optional(),
        maxTurns: z.number().int().min(1).max(500).optional(),
      },
    },
    async ({ runId, prompt, model, maxTurns }) =>
      withDashboardErrors(async () => {
        const { run } = await dashboard.post<{ run: AgentRunSummary }>(`/api/agent/runs/${encodeURIComponent(runId)}`, {
          prompt,
          model,
          maxTurns,
          depth: callerDepth(),
        });
        return text(`Follow-up ${run.id} dispatched.\n${formatRunSummary(run)}`);
      }),
  );

  server.registerTool(
    "agent_cancel",
    {
      description: "Stop an agent run (queued or running). Requires the dashboard running.",
      inputSchema: { runId: runIdSchema },
    },
    async ({ runId }) =>
      withDashboardErrors(async () => {
        const { run, outcome } = await dashboard.delete<{ run: AgentRunSummary; outcome: string }>(
          `/api/agent/runs/${encodeURIComponent(runId)}`,
        );
        const said =
          outcome === "signalled"
            ? "Stop signal sent — the run records itself as cancelled once the CLI exits."
            : outcome === "cancelled"
              ? "Cancelled before it started."
              : "Already finished; nothing to stop.";
        return text(`${said}\n${formatRunSummary(run)}`);
      }),
  );

  server.registerTool(
    "agent_interactive_note",
    {
      description:
        "Append a short progress note to an interactive Agent Activity run (bin=interactive — Claude/etc opened in the dock, not agent_dispatch). Call after your first meaningful update so the Activity panel shows live progress. Requires the dashboard running.",
      inputSchema: {
        runId: runIdSchema,
        text: z.string().trim().min(1).max(8_000).describe("Short status for Agent Activity"),
      },
    },
    async ({ runId, text: note }) =>
      withDashboardErrors(async () => {
        const { run } = await dashboard.post<{ run: AgentRunSummary }>(
          `/api/agent/runs/${encodeURIComponent(runId)}/note`,
          { text: note },
        );
        return text(`Noted on ${run.id}.\n${formatRunSummary(run)}`);
      }),
  );

  server.registerTool(
    "agent_interactive_finish",
    {
      description:
        "Mark an interactive Agent Activity run finished (success or failure) with a result summary. DevHub also closes the run when the CLI exits or its tab closes, but only this call records resultText and sessionId — pass sessionId so Resume/Continue can pick up the CLI session. Requires the dashboard running.",
      inputSchema: {
        runId: runIdSchema,
        ok: z.boolean().describe("true when the task succeeded"),
        resultText: z.string().trim().max(8_000).optional().describe("Short final summary"),
        sessionId: z.string().trim().max(200).optional().describe("CLI session id for later resume"),
        error: z.string().trim().max(2_000).optional().describe("Failure reason when ok is false"),
      },
    },
    async ({ runId, ok, resultText, sessionId, error }) =>
      withDashboardErrors(async () => {
        const { run } = await dashboard.post<{ run: AgentRunSummary }>(
          `/api/agent/runs/${encodeURIComponent(runId)}/finish`,
          { ok, resultText, sessionId, error },
        );
        return text(`Interactive run ${run.state}.\n${formatRunSummary(run)}`);
      }),
  );

  server.registerTool(
    "agent_diff",
    {
      description:
        "Show what an agent run changed: git diff of its cwd (or worktree) against HEAD at dispatch, plus untracked files. Requires the dashboard running.",
      inputSchema: {
        runId: runIdSchema,
        patch: z.boolean().optional().describe("Include the full patch (default true); false = stat only"),
      },
    },
    async ({ runId, patch }) =>
      withDashboardErrors(async () => {
        const { diff } = await dashboard.get<{
          diff: {
            cwd: string;
            baseSha: string | null;
            stat: string;
            patch: string | null;
            untracked: string[];
            truncated: boolean;
            note: string | null;
          };
        }>(`/api/agent/runs/${encodeURIComponent(runId)}/diff`, { patch: patch === false ? 0 : 1 });
        const parts = [
          `Diff for ${runId} in ${diff.cwd}${diff.baseSha ? ` against ${diff.baseSha.slice(0, 12)}` : ""}`,
          diff.note,
          diff.stat ? `\n${diff.stat}` : "\nNo tracked changes.",
          diff.untracked.length ? `\nUntracked:\n${diff.untracked.map((f) => `- ${f}`).join("\n")}` : null,
          diff.patch ? `\n\`\`\`diff\n${diff.patch}\n\`\`\`` : null,
          diff.truncated ? "(patch truncated)" : null,
        ];
        return text(parts.filter(Boolean).join("\n"));
      }),
  );
}
