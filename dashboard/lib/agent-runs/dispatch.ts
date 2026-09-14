/**
 * Dispatch: validate, record a run, and hand it to the terminal dock.
 *
 * The run does not start here. It becomes an auto-run terminal proposal, the
 * dock opens a tab running scripts/agent-run.ts, and that runner owns the CLI's
 * lifetime — so every dispatched agent is visible and killable in DevHub.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clip } from "@/lib/agent-runs/events";
import { agentRunnerCommand } from "@/lib/agent-runs/launch";
import { createRunWorktree, gitHead } from "@/lib/agent-runs/git";
import { getAgentProvider } from "@/lib/agent-runs/providers";
import type { AgentRunWorktree } from "@/lib/agent-runs/run-files";
import {
  agentRunDir,
  countActiveAgentRuns,
  createAgentRun,
  newAgentRunId,
  updateAgentRunStatus,
  type AgentRun,
} from "@/lib/agent-runs/store";
import { createTerminalProposal } from "@/lib/terminal-proposals";

export class AgentDispatchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AgentDispatchError";
  }
}

export interface AgentDispatchInput {
  provider: string;
  prompt: string;
  cwd: string;
  title?: string;
  model?: string;
  /** Run in an isolated git worktree instead of the checkout itself. */
  worktree?: boolean;
  maxTurns?: number;
  /**
   * Caller's nesting level, forwarded by the MCP server from DEVHUB_AGENT_DEPTH.
   * A recursion guard against agents fanning out by accident — not a security
   * boundary, since a caller controls what it sends.
   */
  depth: number;
  parentRunId?: string;
  resumeSessionId?: string;
  /** Follow-ups keep the parent's worktree and diff baseline. */
  inherit?: { baseSha?: string; worktree?: AgentRunWorktree };
}

function envInt(key: string, fallback: number): number {
  const n = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Same rule as the PTY peer: an existing directory under $HOME. */
function validateCwd(raw: string): string {
  const home = os.homedir();
  const resolved = path.resolve(raw.replace(/^~(?=$|\/)/, home));
  if (resolved !== home && !resolved.startsWith(home + path.sep)) {
    throw new AgentDispatchError(`cwd must be inside ${home}`, 400);
  }
  let isDir = false;
  try {
    isDir = fs.statSync(resolved).isDirectory();
  } catch {
    /* reported below */
  }
  if (!isDir) throw new AgentDispatchError(`cwd does not exist or is not a directory: ${resolved}`, 400);
  return resolved;
}

function defaultTitle(prompt: string): string {
  const firstLine = prompt.trim().split("\n")[0] ?? "";
  return clip(firstLine, 60);
}

export async function dispatchAgentRun(input: AgentDispatchInput): Promise<AgentRun> {
  const maxDepth = envInt("DEVHUB_AGENT_MAX_DEPTH", 1);
  if (input.depth >= maxDepth) {
    throw new AgentDispatchError(
      `Nested dispatch refused: the caller is already an agent run (depth ${input.depth}, DEVHUB_AGENT_MAX_DEPTH=${maxDepth}).`,
      409,
    );
  }

  const resolved = getAgentProvider(input.provider);
  if (!resolved) throw new AgentDispatchError(`Unknown provider "${input.provider}" — see agent_providers.`, 400);
  const { spec: provider, binPath } = resolved;
  if (!binPath) {
    throw new AgentDispatchError(`${provider.label} is not installed (looked for ${provider.binaries.join(", ")}).`, 400);
  }
  if (input.resumeSessionId && !provider.supportsResume) {
    throw new AgentDispatchError(`${provider.label} runs cannot be resumed.`, 400);
  }

  const maxActive = envInt("DEVHUB_AGENT_MAX_RUNS", 6);
  if (countActiveAgentRuns() >= maxActive) {
    throw new AgentDispatchError(
      `${maxActive} agent runs are already queued or running (DEVHUB_AGENT_MAX_RUNS). Wait for one or cancel it.`,
      429,
    );
  }

  let cwd = validateCwd(input.cwd);
  const id = newAgentRunId();
  const dir = agentRunDir(id);
  if (!dir) throw new Error(`Generated an invalid run id: ${id}`);
  // Resolve before touching git so a missing runner doesn't leave a stray worktree.
  const command = agentRunnerCommand(dir);

  let worktree = input.inherit?.worktree;
  let baseSha = input.inherit?.baseSha;
  if (!input.inherit) {
    if (input.worktree) {
      try {
        const created = await createRunWorktree(cwd, id);
        worktree = created.worktree;
        baseSha = created.baseSha;
        cwd = created.cwd;
      } catch (err) {
        throw new AgentDispatchError(err instanceof Error ? err.message : String(err), 400);
      }
    } else {
      baseSha = await gitHead(cwd);
    }
  }

  const title = input.title?.trim() || defaultTitle(input.prompt);
  const run = createAgentRun({
    id,
    provider: provider.id,
    providerLabel: provider.label,
    bin: binPath,
    args: provider.buildArgs({
      prompt: input.prompt,
      model: input.model,
      resumeSessionId: input.resumeSessionId,
      maxTurns: provider.supportsMaxTurns ? input.maxTurns : undefined,
    }),
    format: provider.format,
    cwd,
    title,
    prompt: input.prompt,
    model: input.model,
    depth: input.depth,
    createdAt: Date.now(),
    parentRunId: input.parentRunId,
    baseSha,
    worktree,
  });

  try {
    const proposal = createTerminalProposal({
      command,
      cwd,
      label: `${provider.label} · ${title}`,
      summary: `${provider.label}: ${title}`,
      kind: "shell",
      repoName: path.basename(worktree?.repoRoot ?? cwd),
      reason: `Agent run ${id}`,
      source: "api",
      autoRun: true,
    });
    return updateAgentRunStatus(run, { proposalId: proposal.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateAgentRunStatus(run, { state: "failed", finishedAt: Date.now(), error: message });
    throw new AgentDispatchError(message, 429);
  }
}
