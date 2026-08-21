/**
 * First-class agent job launcher.
 *
 * Agent/Review jobs open an in-dock chat host (composer + transcript).
 * Headless text gen (briefings, learn-repo) stays on generateAiText.
 * MCP `terminal_propose_run` still goes through propose → confirm → PTY inject
 * on a real shell tab — never into the chat pane.
 *
 * `provider` is optional — defaults to the shared AI provider preference
 * (`DEVHUB_AI_PROVIDER` via `/api/agent-cli`).
 */

"use client";

import {
  getAgentCliConfig,
  launchCliFromProvider,
  type AgentCli,
  type AgentCliConfig,
  type AiProviderId,
} from "@/lib/agent/cli-config";
import { openAgentChat } from "@/lib/agent-chat";
import {
  cliUnavailableMessage,
  formatAgentJobSummary,
  providerDisplayName,
} from "@/lib/agent-status";
import { proposeTerminalRun } from "@/lib/terminal-inject";
import { isAgentLikeKind, type TerminalSessionKind } from "@/lib/terminal-meta";
import { formatTerminalTabLabel } from "@/lib/terminal-meta";

export type AgentJobMode = "oneshot" | "interactive";

/** Launch channel ids — maps from shared `AiProviderId` (api → best local CLI). */
export type AgentJobProvider = AgentCli | (string & {});

export interface AgentJobOptions {
  /** Prompt text (already built by terminal-launch helpers). Kept for upstart PTY. */
  promptCommand: string;
  /** Raw prompt for chat / OpenCode HTTP. Prefer this. */
  promptText?: string;
  title: string;
  /**
   * Human chip/banner copy. Defaults to title + provider when omitted
   * (e.g. "Review PR #123 with Cursor").
   */
  summary?: string;
  kind?: TerminalSessionKind;
  cwd?: string;
  repoName?: string;
  notePath?: string;
  mode?: AgentJobMode;
  /**
   * Prefer this provider when set; otherwise use Agent CLI settings.
   * Accepts future ids from the shared provider switch without breaking callers.
   */
  provider?: AgentJobProvider;
  /**
   * Force the terminal PTY path (upstart generation that must share a tab
   * with bash). Ignored for agent/review — those are always chat.
   */
  forceTerminal?: boolean;
  reason?: string;
  /** Caller already collected user intent (prompt dialog) — soft confirm only. */
  alreadyConfirmed?: boolean;
}

export type AgentJobResult =
  | { channel: "opencode"; sessionId: string; provider: AgentJobProvider }
  | { channel: "terminal"; proposeId: string; provider: AgentJobProvider }
  | { channel: "chat"; provider: AgentJobProvider };

export type InteractiveAgentOpenResult =
  | { channel: "opencode"; provider: AgentJobProvider }
  | { channel: "terminal"; proposeId: string; provider: AgentJobProvider }
  | { channel: "chat"; provider: AgentJobProvider };

export { formatAgentJobSummary, providerDisplayName };

function resolveProvider(
  explicit: AgentJobProvider | undefined,
  config: { cli: AgentCli; provider: AiProviderId | null },
): AgentJobProvider {
  if (explicit && String(explicit).trim()) return explicit;
  if (config.provider === "api") return "api";
  return launchCliFromProvider(config.provider, config.cli);
}

function asChatKind(kind?: TerminalSessionKind): "agent" | "review" {
  return kind === "review" ? "review" : "agent";
}

function isChatConfigured(
  provider: AgentJobProvider,
  config: AgentCliConfig,
): boolean {
  if (provider === "cursor") return config.cursorAgentInstalled;
  if (provider === "chatgpt") return config.chatgptCliInstalled;
  if (provider === "opencode") return config.opencodeInstalled;
  if (provider === "api") return config.apiConfigured;
  return (
    config.cursorAgentInstalled ||
    config.chatgptCliInstalled ||
    config.opencodeInstalled ||
    config.apiConfigured
  );
}

function openFailedAgentTab(opts: {
  cwd?: string;
  repoName?: string;
  provider: AgentJobProvider;
  kind?: TerminalSessionKind;
  title?: string;
}): void {
  openAgentChat({
    title: opts.title?.trim() || `Agent · ${providerDisplayName(opts.provider)}`,
    kind: asChatKind(opts.kind),
    cwd: opts.cwd,
    repoName: opts.repoName,
    summary: cliUnavailableMessage(String(opts.provider)),
    providerLabel: providerDisplayName(opts.provider),
    autoSend: false,
    forceNewTab: true,
    agentPhase: "failed",
  });
}

function launchChatJob(opts: AgentJobOptions, provider: AgentJobProvider): AgentJobResult {
  const kind = asChatKind(opts.kind);
  const summary = formatAgentJobSummary({
    title: opts.title,
    provider: String(provider),
    summary: opts.summary,
    kind,
  });
  const display =
    opts.summary?.trim() ||
    (kind === "review" ? opts.title : opts.title);
  const prompt = opts.promptText?.trim();
  openAgentChat({
    title: formatTerminalTabLabel({
      label: opts.title,
      kind,
      repoName: opts.repoName,
      cwd: opts.cwd,
    }),
    prompt,
    display,
    kind,
    cwd: opts.cwd,
    repoName: opts.repoName,
    summary,
    providerLabel: providerDisplayName(String(provider)),
    autoSend: Boolean(prompt),
    forceNewTab: Boolean(prompt),
  });
  return { channel: "chat", provider };
}

/**
 * Launch an agent job via the best available channel.
 * Agent/review → in-dock chat. Upstart and other PTY jobs stay on propose/inject.
 */
export async function launchAgentJob(opts: AgentJobOptions): Promise<AgentJobResult> {
  const config = await getAgentCliConfig(true);
  const provider = resolveProvider(opts.provider, config);
  const kind = opts.kind ?? "agent";

  if (isAgentLikeKind(kind)) {
    if (!isChatConfigured(provider, config)) {
      openFailedAgentTab({
        cwd: opts.cwd,
        repoName: opts.repoName,
        provider,
        kind,
        title: opts.title,
      });
      return { channel: "chat", provider };
    }
    return launchChatJob(opts, provider);
  }

  const providerLabel = providerDisplayName(String(provider));
  const summary = formatAgentJobSummary({
    title: opts.title,
    provider,
    summary: opts.summary,
    kind,
  });
  const label = formatTerminalTabLabel({
    label: opts.title,
    kind,
    repoName: opts.repoName,
    cwd: opts.cwd,
  });

  const proposeId = proposeTerminalRun({
    command: opts.promptCommand,
    cwd: opts.cwd,
    label,
    summary,
    providerLabel,
    kind,
    repoName: opts.repoName,
    preferAgentTab: false,
    reason: opts.reason ?? summary,
    source: "agent-job",
    mode: opts.mode ?? "oneshot",
    skipConfirm: opts.alreadyConfirmed === true,
  });

  return { channel: "terminal", proposeId, provider };
}

/**
 * Open Agent from the dock template / "+" menu: ready to chat with the
 * configured provider — not an empty shell waiting for inject.
 */
export async function openInteractiveAgentSession(opts?: {
  cwd?: string;
  repoName?: string;
}): Promise<InteractiveAgentOpenResult> {
  const config = await getAgentCliConfig(true);
  const provider = resolveProvider(undefined, config);
  const providerLabel = providerDisplayName(String(provider));
  const title = opts?.repoName ? `${providerLabel} · ${opts.repoName}` : providerLabel;

  if (!isChatConfigured(provider, config)) {
    openFailedAgentTab({
      cwd: opts?.cwd,
      repoName: opts?.repoName,
      provider,
      title,
    });
    return { channel: "chat", provider };
  }

  openAgentChat({
    title,
    kind: "agent",
    cwd: opts?.cwd,
    repoName: opts?.repoName,
    providerLabel,
    autoSend: false,
  });
  return { channel: "chat", provider };
}

/** Navigate helper used after OpenCode launch (callers with useRouter). */
export function openCodeHref(): string {
  return "/opencode";
}
