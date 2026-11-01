import { z } from "zod";
import { defineAction } from "./define.ts";

interface AgentLocalContext<Schema extends z.ZodObject> {
  execute: (input: z.output<Schema>) => unknown;
}

function localAgentAction<Schema extends z.ZodObject>(input: Schema, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, reason: string) {
  return defineAction<Schema, AgentLocalContext<Schema>, unknown>({
    input,
    http: { method, path },
    mcp: { reason },
    handler: (value, context) => context.execute(value),
  });
}

export const agentConnectionInput = z.object({});
export const agentConnection = localAgentAction(agentConnectionInput, "GET", "/api/agent/connection", "The launch sheet's local Paseo connection details are a dashboard view.");
export const agentBootstrapInput = z.object({});
export const agentBootstrap = localAgentAction(agentBootstrapInput, "POST", "/api/agent/connection/bootstrap", "The local chat frame bootstrap returns a credential and must not be exposed to MCP.");
export const agentCapacityInput = z.object({});
export const agentCapacity = localAgentAction(agentCapacityInput, "GET", "/api/agent/runs/capacity", "Dispatch capacity is a dashboard run-management view.");
export const agentClearInput = z.object({ id: z.string() });
export const agentClear = localAgentAction(agentClearInput, "POST", "/api/agent/runs/[id]/clear", "Clearing an abandoned local run is an interactive dashboard control.");

export const agentBackgroundInput = z.object({
  prompt: z.string().trim().min(1, "prompt is required").max(32_000, "prompt too long"),
  title: z.string().optional(),
  directory: z.string().optional(),
  notePath: z.string().optional(),
  kind: z.string().optional(),
  repoName: z.string().optional(),
  provider: z.string().optional(),
});
export const agentBackground = localAgentAction(agentBackgroundInput, "POST", "/api/agent/run", "This dashboard launch attaches local activity and note context.");

export const agentInteractiveInput = z.object({
  provider: z.string().trim().min(1).max(64),
  prompt: z.string().trim().min(1).max(32_000),
  cwd: z.string().trim().min(1).max(1_000),
  title: z.string().trim().max(80).optional(),
  model: z.string().trim().max(120).optional(),
  sessionId: z.string().trim().max(200).optional(),
  parentRunId: z.string().trim().max(64).optional(),
  taskId: z.string().trim().min(1).max(80).optional(),
  runId: z.string().trim().max(64).optional(),
});
export const agentInteractive = localAgentAction(agentInteractiveInput, "POST", "/api/agent/runs/interactive", "Registering a local interactive terminal run belongs to the dashboard launcher.");

export const agentsCatalogListInput = z.object({}).meta({ additionalProperties: false });
export interface AgentsCatalogListContext {
  read: () => unknown;
}
export const agentsCatalogList = defineAction<typeof agentsCatalogListInput, AgentsCatalogListContext, unknown>({
  input: agentsCatalogListInput,
  http: { method: "GET", path: "/api/agents" },
  mcp: { name: "agents_list", toolset: "workspace", description: "List the agents configured in this workspace (core + plugin agents)." },
  handler: (_input, context) => context.read(),
});

const agentCatalogSlug = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/);
export const agentCatalogCreateInput = z.object({ name: agentCatalogSlug, description: z.string() });
export const agentCatalogCreate = localAgentAction(agentCatalogCreateInput, "POST", "/api/agents", "Creating shared agent definitions is a dashboard editing workflow.");
export const agentCatalogReadInput = z.object({ name: z.string() });
export const agentCatalogRead = localAgentAction(agentCatalogReadInput, "GET", "/api/agents/[name]", "Reading one agent definition is a dashboard editor view.");
export const agentCatalogSaveInput = z.object({ name: z.string(), content: z.string().refine((content) => Boolean(content.trim())) });
export const agentCatalogSave = localAgentAction(agentCatalogSaveInput, "PUT", "/api/agents/[name]", "Editing agent definitions is a dashboard workflow.");
export const agentCatalogRenameInput = z.object({ name: z.string(), newName: agentCatalogSlug });
export const agentCatalogRename = localAgentAction(agentCatalogRenameInput, "PATCH", "/api/agents/[name]", "Renaming agent definitions is a dashboard workflow.");
export const agentCatalogDeleteInput = z.object({ name: z.string() });
export const agentCatalogDelete = localAgentAction(agentCatalogDeleteInput, "DELETE", "/api/agents/[name]", "Deleting agent definitions is a dashboard workflow.");
export const localAgentCandidatesInput = z.object({});
export const localAgentCandidates = localAgentAction(localAgentCandidatesInput, "GET", "/api/agents/local", "The local import picker scans installations on the dashboard host.");
export const localAgentReadInput = z.object({ name: z.string() });
export const localAgentRead = localAgentAction(localAgentReadInput, "GET", "/api/agents/local/[name]", "Installed agent content is a local dashboard view.");
export const localAgentDeleteInput = z.object({ name: z.string() });
export const localAgentDelete = localAgentAction(localAgentDeleteInput, "DELETE", "/api/agents/local/[name]", "Removing local agent installations is an interactive dashboard workflow.");

export const agentDispatchInput = z.object({
  requestId: z.string().min(1).max(200).optional().describe("Stable key for retries of this same submission"),
  provider: z.string().min(1).describe("Provider id from agent_providers, e.g. claude, cursor, codex"),
  prompt: z.string().min(1).max(32_000).describe("The full task. The agent has no other context from you."),
  cwd: z.string().min(1).describe("Absolute directory under the user's home — usually a repo root"),
  title: z.string().max(80).optional().describe("Short label for the terminal tab"),
  model: z.string().max(120).optional().describe("Provider-specific model id"),
  effort: z.string().max(32).optional().describe("Reasoning effort (low, medium, high, xhigh, max, or a provider thinking option). Omit for the provider default."),
  worktree: z.boolean().optional().describe("Isolated git worktree on a new branch (default false)"),
  maxTurns: z.number().int().min(1).max(500).optional().describe("Turn cap, for providers that support it"),
}).meta({ additionalProperties: false });

export const agentDispatchBodyInput = agentDispatchInput.extend({
  provider: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1, "prompt is required").max(32_000, "prompt too long"),
  cwd: z.string().trim().min(1, "cwd is required").max(1_000),
  title: z.string().trim().max(80).optional(),
  model: z.string().trim().max(120).optional(),
  tier: z.enum(["cheap", "mid", "heavy"]).optional(),
  effort: z.string().trim().max(32).regex(/^([A-Za-z0-9][A-Za-z0-9_-]{0,31})?$/).optional(),
  taskId: z.string().min(1).max(100).optional(),
  taskDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  action: z.enum(["plan", "implement", "resume", "agent", "review", "create-pr"]).optional(),
  repoName: z.string().max(200).optional(),
  notePath: z.string().max(1000).optional(),
  prUrl: z.string().url().refine((value) => /^https?:\/\//.test(value)).optional(),
  headSha: z.string().regex(/^[a-f0-9]{7,64}$/).optional(),
  parentRunId: z.string().max(100).optional(),
  resumeSessionId: z.string().max(200).optional(),
  depth: z.number().int().min(0).max(20).default(0),
  defer: z.boolean().optional(),
});

export interface AgentDispatchResult {
  status: number;
  body: unknown;
}

export interface AgentDispatchContext {
  dispatch: (input: z.output<typeof agentDispatchInput>) => Promise<AgentDispatchResult>;
}

export const agentDispatch = defineAction<typeof agentDispatchInput, AgentDispatchContext, AgentDispatchResult>({
  input: agentDispatchInput,
  http: { method: "POST", path: "/api/agent/runs" },
  mcp: {
    name: "agent_dispatch",
    toolset: "agents",
    description: "Start a task in a new Paseo agent. Defaults to the Connection tab's agent (Cursor + Grok unless changed) in its full-auto mode unless you pass provider/model. No terminal or window opens. An isolated git worktree is the default; worktree:false uses cwd directly. Returns a durable run and conversation ID. Follow with agent_wait or agent_output; approvals remain in Agents. Reuse requestId when retrying the same submission to avoid duplicate work. Native turn/time/usage limits are available only when the runtime advertises them.",
  },
  handler: (input, context) => context.dispatch(input),
});

export const agentProvidersInput = z.object({}).meta({ additionalProperties: false });

export interface AgentProvidersContext {
  read: () => Promise<{
    providers: Array<{ id: string; label: string; installed: boolean; supportsResume: boolean; supportsMaxTurns: boolean; custom: boolean }>;
    providersConfigError: string | null;
  }>;
}

export const agentProviders = defineAction<typeof agentProvidersInput, AgentProvidersContext, string>({
  input: agentProvidersInput,
  http: { reason: "The provider-only view is an MCP projection of the dashboard's agent-run listing." },
  mcp: {
    name: "agent_providers", toolset: "agents",
    description: "List the agents Paseo can run (Claude, Cursor, Codex, OpenCode, Copilot…), their readiness and models. Requires DevHub and its Paseo daemon (Agents → Connection).",
  },
  handler: async (_input, context) => {
    const data = await context.read();
    const lines = data.providers.map((provider) => {
      const caps = [provider.supportsResume ? "follow-ups" : null, provider.supportsMaxTurns ? "maxTurns" : null, provider.custom ? "custom" : null]
        .filter(Boolean)
        .join(", ");
      return `- ${provider.id} (${provider.label}): ${provider.installed ? "installed" : "NOT installed"}${caps ? ` · ${caps}` : ""}`;
    });
    return ["Agent providers:", ...lines, data.providersConfigError ? `\nCustom provider config error: ${data.providersConfigError}` : null, "\nCheck agents in Agents → Connection. Use only advertised models."].filter(Boolean).join("\n");
  },
});

export const agentRunsInput = z.object({
  limit: z.number().int().min(1).max(100).optional(),
}).meta({ additionalProperties: false });

export interface AgentRunsContext {
  read: (limit?: number) => Promise<unknown>;
}

export const agentRuns = defineAction<typeof agentRunsInput, AgentRunsContext, unknown>({
  input: agentRunsInput,
  http: { method: "GET", path: "/api/agent/runs" },
  mcp: { name: "agent_runs", toolset: "agents", description: "List recent agent runs (newest first) with their state. Requires the dashboard running." },
  handler: ({ limit }, context) => context.read(limit),
});

export const agentRaceInput = z.object({
  providers: z.array(z.string().min(1)).min(2).max(4).describe("Distinct provider ids"),
  prompt: z.string().min(1).max(32_000),
  cwd: z.string().min(1).describe("Absolute path inside a git repository"),
  title: z.string().max(60).optional(),
  maxTurns: z.number().int().min(1).max(500).optional(),
}).meta({ additionalProperties: false });

export interface AgentRaceContext {
  dispatch: (input: { provider: string; prompt: string; cwd: string; title?: string; maxTurns?: number }) => Promise<{ id: string; worktree: { branch: string } | null; cwd: string }>;
}

export const agentRace = defineAction<typeof agentRaceInput, AgentRaceContext, { text: string; isError?: boolean }>({
  input: agentRaceInput,
  http: { reason: "This MCP operation aggregates multiple dispatch requests; there is no dashboard race endpoint." },
  mcp: {
    name: "agent_race", toolset: "agents",
    description: "Send the same task to 2–4 Paseo agents, each in its own worktree and chat. Each runs in its harness's full-auto mode. Compare results with agent_diff; no terminal or window opens.",
  },
  handler: async ({ providers, prompt, cwd, title, maxTurns }, context) => {
    const unique = [...new Set(providers)];
    if (unique.length < 2) return { text: "agent_race needs at least two distinct providers.", isError: true };
    const lines: string[] = [];
    for (const provider of unique) {
      try {
        const run = await context.dispatch({ provider, prompt, cwd, title: title ? `${title} (${provider})` : undefined, maxTurns });
        lines.push(`- ${provider}: ${run.id} → ${run.worktree?.branch ?? run.cwd}`);
      } catch (error) {
        lines.push(`- ${provider}: FAILED — ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return {
      text: ["Race dispatched:", ...lines, "", "agent_wait each run, then agent_diff each to compare. Worktrees live in <repos-dir>/.devhub-worktrees/<repo>/."]
        .join("\n"),
    };
  },
});

const agentRunId = z.string().regex(/^run-[a-z0-9-]+$/, "a run id from agent_dispatch or agent_runs");

export const agentCancelInput = z.object({ runId: agentRunId }).meta({ additionalProperties: false });

export interface AgentCancelContext {
  cancel: (runId: string) => Promise<AgentDispatchResult>;
}

export const agentCancel = defineAction<typeof agentCancelInput, AgentCancelContext, AgentDispatchResult>({
  input: agentCancelInput,
  http: { method: "DELETE", path: "/api/agent/runs/[id]" },
  mcp: { name: "agent_cancel", toolset: "agents", description: "Stop an agent run (queued or running). Requires the dashboard running." },
  handler: ({ runId }, context) => context.cancel(runId),
});

export const agentOutputInput = z.object({
  runId: agentRunId,
  since: z.number().int().min(0).optional().describe("Event cursor (default 0)"),
  limit: z.number().int().min(1).max(500).optional().describe("Max events (default 200)"),
}).meta({ additionalProperties: false });

export interface AgentOutputContext {
  read: (input: z.output<typeof agentOutputInput>) => Promise<unknown> | unknown;
}

export const agentOutput = defineAction<typeof agentOutputInput, AgentOutputContext, { page: unknown; from: number }>({
  input: agentOutputInput,
  http: { method: "GET", path: "/api/agent/runs/[id]" },
  mcp: {
    name: "agent_output", toolset: "agents",
    description: "Read an agent run's status and its events (text, tool calls, results) from a cursor. Returns immediately; pass the returned cursor as `since` next time. Requires the dashboard running.",
  },
  handler: async (input, context) => ({ page: await context.read(input), from: input.since ?? 0 }),
});

export const agentDiffInput = z.object({
  runId: agentRunId,
  patch: z.boolean().optional().describe("Include the full patch (default true); false = stat only"),
}).meta({ additionalProperties: false });

export interface AgentDiffContext {
  diff: (input: z.output<typeof agentDiffInput>) => Promise<AgentDispatchResult>;
}

export const agentDiff = defineAction<typeof agentDiffInput, AgentDiffContext, AgentDispatchResult>({
  input: agentDiffInput,
  http: { method: "GET", path: "/api/agent/runs/[id]/diff" },
  mcp: {
    name: "agent_diff", toolset: "agents",
    description: "Show what an agent run changed: git diff of its cwd (or worktree) against HEAD at dispatch, plus untracked files. Requires the dashboard running.",
  },
  handler: (input, context) => context.diff(input),
});

export const agentFollowupInput = z.object({
  runId: agentRunId,
  prompt: z.string().min(1).max(32_000),
  model: z.string().max(120).optional(),
  effort: z.string().max(32).optional().describe("Reasoning effort. Omit to keep the run's current effort."),
  maxTurns: z.number().int().min(1).max(500).optional(),
}).meta({ additionalProperties: false });

export const agentFollowupBodyInput = agentFollowupInput.omit({ runId: true }).extend({
  requestId: z.string().min(1).max(200).optional(),
  prompt: z.string().trim().min(1, "prompt is required").max(32_000, "prompt too long"),
  model: z.string().trim().max(120).optional(),
  effort: z.string().trim().max(32).regex(/^([A-Za-z0-9][A-Za-z0-9_-]{0,31})?$/).optional(),
  depth: z.number().int().min(0).max(20).default(0),
});

export interface AgentFollowupContext {
  resume: (input: z.output<typeof agentFollowupInput>) => Promise<AgentDispatchResult>;
}

export const agentFollowup = defineAction<typeof agentFollowupInput, AgentFollowupContext, AgentDispatchResult>({
  input: agentFollowupInput,
  http: { method: "POST", path: "/api/agent/runs/[id]" },
  mcp: {
    name: "agent_followup", toolset: "agents",
    description: "Continue a finished agent run: starts a new run that resumes the same CLI session in the same cwd/worktree (providers with follow-up support only). Requires the dashboard running.",
  },
  handler: (input, context) => context.resume(input),
});

export const agentInteractiveNoteInput = z.object({
  runId: agentRunId,
  text: z.string().trim().min(1).max(8_000).describe("Short status for Agent Activity"),
}).meta({ additionalProperties: false });

export interface AgentInteractiveNoteContext {
  note: (input: z.output<typeof agentInteractiveNoteInput>) => Promise<{ run: unknown }> | { run: unknown };
}

export const agentInteractiveNote = defineAction<typeof agentInteractiveNoteInput, AgentInteractiveNoteContext, { run: unknown }>({
  input: agentInteractiveNoteInput,
  http: { method: "POST", path: "/api/agent/runs/[id]/note" },
  mcp: {
    name: "agent_interactive_note", toolset: "agents",
    description: "Append a short progress note to an interactive Agent Activity run (bin=interactive — Claude/etc opened in the dock, not agent_dispatch). Call after your first meaningful update so the Activity panel shows live progress. Only use a run id the prompt gave you as an Activity run: Paseo-dispatched runs (agent_dispatch, Implement with Agent) record their own conversation and reject notes with a 400. Requires the dashboard running.",
  },
  handler: (input, context) => context.note(input),
});

export const agentInteractiveFinishInput = z.object({
  runId: agentRunId,
  ok: z.boolean().describe("true when the task succeeded"),
  resultText: z.string().trim().max(8_000).optional().describe("Short final summary"),
  sessionId: z.string().trim().max(200).optional().describe("CLI session id for later resume"),
  error: z.string().trim().max(2_000).optional().describe("Failure reason when ok is false"),
}).meta({ additionalProperties: false });

export interface AgentInteractiveFinishContext {
  finish: (input: z.output<typeof agentInteractiveFinishInput>) => Promise<{ run: unknown }> | { run: unknown };
}

export const agentInteractiveFinish = defineAction<typeof agentInteractiveFinishInput, AgentInteractiveFinishContext, { run: unknown }>({
  input: agentInteractiveFinishInput,
  http: { method: "POST", path: "/api/agent/runs/[id]/finish" },
  mcp: {
    name: "agent_interactive_finish", toolset: "agents",
    description: "Mark an interactive Agent Activity run finished (success or failure) with a result summary. DevHub also closes the run when the CLI exits or its tab closes, but only this call records resultText and sessionId — pass sessionId so Resume/Continue can pick up the CLI session. Requires the dashboard running.",
  },
  handler: (input, context) => context.finish(input),
});

export const agentWaitInput = z.object({
  runId: agentRunId,
  since: z.number().int().min(0).optional().describe("Event cursor to collect from (default 0)"),
  until: z.enum(["finished", "activity"]).optional().describe("Default finished"),
  timeoutSeconds: z.number().int().min(1).max(300).optional().describe("Default 120, max 300"),
}).meta({ additionalProperties: false });

export interface AgentWaitRequest {
  signal: AbortSignal;
  progressToken?: string | number;
  notify: (progress: number, message?: string) => Promise<void>;
}

export interface AgentWaitContext {
  request?: AgentWaitRequest;
  wait: (input: z.output<typeof agentWaitInput>, request?: AgentWaitRequest) => Promise<string>;
}

export const agentWait = defineAction<typeof agentWaitInput, AgentWaitContext, string>({
  input: agentWaitInput,
  http: { reason: "MCP polling uses request-scoped cancellation and progress notifications." },
  mcp: {
    name: "agent_wait",
    toolset: "agents",
    description: "Block until an agent run finishes (or, with until=activity, until it emits new events), up to timeoutSeconds. Sends MCP progress notifications while waiting when the client asks for them. On timeout, call again with the returned cursor. Requires the dashboard running.",
  },
  handler: (input, context) => context.wait(input, context.request),
});
