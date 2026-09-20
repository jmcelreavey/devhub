"use client";

import { navigateToAgents,openAgentHandoff } from "@/lib/agent-handoff";
import { formatAgentJobSummary,providerDisplayName } from "@/lib/agent-status";
import { getAgentCliConfig,launchCliFromProvider,type AgentCli } from "@/lib/agent/cli-config";
import { proposeTerminalRun } from "@/lib/terminal-inject";
import { formatTerminalTabLabel,isAgentLikeKind,type TerminalSessionKind } from "@/lib/terminal-meta";

export type AgentJobMode = "oneshot" | "interactive";
export type AgentJobProvider = AgentCli | (string & {});
export interface AgentJobOptions {
  promptCommand?: string;
  promptText?: string;
  title: string;
  summary?: string;
  kind?: TerminalSessionKind;
  cwd?: string;
  repoName?: string;
  notePath?: string;
  prUrl?: string;
  headSha?: string;
  mode?: AgentJobMode;
  provider?: AgentJobProvider;
  forceTerminal?: boolean;
  reason?: string;
  alreadyConfirmed?: boolean;
}
export type AgentJobResult =
  | { channel: "terminal"; proposeId: string; provider: AgentJobProvider }
  | { channel: "chat"; provider: AgentJobProvider };
export type InteractiveAgentOpenResult = { channel: "chat"; provider: AgentJobProvider };
export { formatAgentJobSummary,providerDisplayName };

/** AI actions share one reviewable handoff. Ordinary commands retain proposal/confirm. */
export async function launchAgentJob(opts: AgentJobOptions): Promise<AgentJobResult> {
  const kind = opts.kind ?? "agent";
  if (isAgentLikeKind(kind) || opts.promptText) {
    openAgentHandoff({
      title: opts.title, prompt: opts.promptText, cwd: opts.cwd, repoName: opts.repoName,
      notePath: opts.notePath, prUrl: opts.prUrl, headSha: opts.headSha, provider: opts.provider, kind: kind === "review" ? "review" : "agent",
      worktree: kind === "agent",
    });
    return { channel: "chat", provider: opts.provider || "" };
  }

  const config = await getAgentCliConfig(true);
  if (!opts.promptCommand) throw new Error("A terminal command is required.");
  const provider = opts.provider || launchCliFromProvider(config.provider, config.cli);
  const summary = formatAgentJobSummary({ title: opts.title, provider, summary: opts.summary, kind });
  const proposeId = proposeTerminalRun({
    command: opts.promptCommand, cwd: opts.cwd,
    label: formatTerminalTabLabel({ label: opts.title, kind, repoName: opts.repoName, cwd: opts.cwd }),
    summary, providerLabel: providerDisplayName(provider), kind, repoName: opts.repoName,
    reason: opts.reason ?? summary, source: "agent-job", mode: opts.mode ?? "oneshot",
    skipConfirm: opts.alreadyConfirmed === true,
  });
  return { channel: "terminal", proposeId, provider };
}

export async function openInteractiveAgentSession(opts?: { cwd?: string; repoName?: string }): Promise<InteractiveAgentOpenResult> {
  if (opts?.cwd) openAgentHandoff({ title: opts.repoName ? `Ask Agent · ${opts.repoName}` : "Ask Agent", ...opts });
  else navigateToAgents();
  return { channel: "chat", provider: "" };
}
