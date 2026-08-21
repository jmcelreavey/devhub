/**
 * First-class AI provider preference for DevHub.
 *
 * One switch covers in-app generation (learn-repo, briefings, …) and agent
 * launches. Local CLIs are preferred over requiring a third-party API key.
 *
 * Env: `DEVHUB_AI_PROVIDER` = cursor-cli | chatgpt-cli | opencode | api
 * Legacy: `DEVHUB_AGENT_CLI` = cursor | opencode | chatgpt still maps in.
 */

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { isCursorAgentInstalled } from "@/lib/agent/cli-env";
import { readDashboardEnvLocalFile, resolveEnvValue } from "@/lib/dashboard-env-local";
import { isNotesAiConfigured } from "@/lib/notes-ai/config";
import { resolveOpenCodeBinary } from "@/lib/opencode/command";
import { isChatGPTConfigured, isOpenCodeConfigured } from "@/lib/peer-service-availability";

export const AI_PROVIDER_IDS = ["cursor-cli", "chatgpt-cli", "opencode", "api"] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

/** Agent-launch ids used by terminal-launch / agent-job (short names). */
export type AgentLaunchCli = "cursor" | "chatgpt" | "opencode";

export interface AiProviderAvailability {
  "cursor-cli": boolean;
  "chatgpt-cli": boolean;
  opencode: boolean;
  api: boolean;
}

export interface ResolvedAiProvider {
  /** Ready provider, or null when nothing usable is installed/configured. */
  provider: AiProviderId | null;
  /** Explicit preference from env (null = auto). */
  configured: AiProviderId | null;
  availability: AiProviderAvailability;
  /** True when we could not use `configured` and fell back. */
  fallback: boolean;
  setupHint: string | null;
}

const FALLBACK_ORDER: AiProviderId[] = ["cursor-cli", "chatgpt-cli", "opencode", "api"];

const CHATGPT_APP_CODEX = "/Applications/ChatGPT.app/Contents/Resources/codex";

export function normalizeAiProvider(raw: string | undefined | null): AiProviderId | null {
  const v = raw?.trim().toLowerCase();
  if (!v) return null;
  if (v === "cursor-cli" || v === "cursor") return "cursor-cli";
  if (v === "chatgpt-cli" || v === "chatgpt" || v === "codex") return "chatgpt-cli";
  if (v === "opencode") return "opencode";
  if (v === "api" || v === "http" || v === "notes-ai") return "api";
  return null;
}

/** Map a provider id to the agent-launch CLI channel. */
export function toAgentLaunchCli(provider: AiProviderId): AgentLaunchCli {
  if (provider === "cursor-cli") return "cursor";
  if (provider === "chatgpt-cli") return "chatgpt";
  return "opencode";
}

/** Map legacy / launch CLI ids back to the shared provider id. */
export function fromAgentLaunchCli(cli: string | undefined | null): AiProviderId | null {
  const v = cli?.trim().toLowerCase();
  if (v === "cursor") return "cursor-cli";
  if (v === "chatgpt" || v === "codex") return "chatgpt-cli";
  if (v === "opencode") return "opencode";
  return null;
}

/**
 * Explicit preference from env. Prefers `DEVHUB_AI_PROVIDER`; falls back to
 * mapping `DEVHUB_AGENT_CLI` so existing setups keep working.
 */
export function readConfiguredAiProvider(): AiProviderId | null {
  const { overrides } = readDashboardEnvLocalFile();
  const fromProvider = normalizeAiProvider(resolveEnvValue("DEVHUB_AI_PROVIDER", overrides));
  if (fromProvider) return fromProvider;
  return fromAgentLaunchCli(resolveEnvValue("DEVHUB_AGENT_CLI", overrides));
}

export function detectAiProviderAvailability(): AiProviderAvailability {
  return {
    "cursor-cli": isCursorAgentInstalled(),
    "chatgpt-cli": isChatgptCliInstalled(),
    opencode: isOpenCodeConfigured(),
    api: isNotesAiConfigured(),
  };
}

/** Bundled ChatGPT.app Codex or `codex`/`chatgpt` on PATH. */
export function isChatgptCliInstalled(): boolean {
  // Peer gate already covers PATH + ChatGPT.app install detection.
  return isChatGPTConfigured();
}

function commandOnPath(cmd: string): boolean {
  const which = process.platform === "win32" ? "where" : "which";
  return spawnSync(which, [cmd], { stdio: "ignore" }).status === 0;
}

export function resolveChatgptCliBin(): string | null {
  if (fs.existsSync(CHATGPT_APP_CODEX)) {
    try {
      fs.accessSync(CHATGPT_APP_CODEX, fs.constants.X_OK);
      return CHATGPT_APP_CODEX;
    } catch {
      /* fall through */
    }
  }
  // Align with isChatGPTConfigured gate — prefer codex, then chatgpt.
  if (commandOnPath("codex")) return "codex";
  if (commandOnPath("chatgpt")) return "chatgpt";
  return null;
}

export function resolveOpencodeCliBin(): string {
  return resolveOpenCodeBinary();
}

function setupHintFor(id: AiProviderId): string {
  switch (id) {
    case "cursor-cli":
      return "Install cursor-agent (curl https://cursor.com/install -fsS | bash), then pick Cursor CLI under Setup → AI Provider.";
    case "chatgpt-cli":
      return "Install the ChatGPT app (bundled Codex CLI) or the Codex CLI, then pick ChatGPT CLI under Setup → AI Provider.";
    case "opencode":
      return "Install opencode, then pick OpenCode under Setup → AI Provider.";
    case "api":
      return "Set AI_API_KEY in dashboard/.env.local (and optionally AI_BASE_URL / AI_MODEL), then pick HTTP API under Setup → AI Provider.";
  }
}

/**
 * Resolve the provider to use right now.
 * When no preference is set, auto-picks the first available local CLI, then API.
 */
export function resolveAiProvider(opts?: {
  prefer?: AiProviderId | null;
}): ResolvedAiProvider {
  const configured =
    opts?.prefer !== undefined ? opts.prefer : readConfiguredAiProvider();
  const availability = detectAiProviderAvailability();

  const order: AiProviderId[] = configured
    ? [configured, ...FALLBACK_ORDER.filter((p) => p !== configured)]
    : FALLBACK_ORDER;

  for (const id of order) {
    if (!availability[id]) continue;
    const fallback = configured !== null && configured !== id;
    return {
      provider: id,
      configured,
      availability,
      fallback,
      setupHint: fallback && configured ? setupHintFor(configured) : null,
    };
  }

  return {
    provider: null,
    configured,
    availability,
    fallback: false,
    setupHint: configured
      ? setupHintFor(configured)
      : "Install cursor-agent, ChatGPT/Codex, or OpenCode — or set AI_API_KEY — then pick a default under Setup → AI Provider.",
  };
}

/** True when at least one generation path works (CLI or API). */
export function isAiConfigured(): boolean {
  return resolveAiProvider().provider !== null;
}

/**
 * Agent-launch CLI for the resolved (or preferred) provider.
 * When provider is `api`, prefer OpenCode HTTP/CLI, then other local CLIs.
 */
export function resolveAgentLaunchCli(resolved?: ResolvedAiProvider): AgentLaunchCli {
  const r = resolved ?? resolveAiProvider();
  if (r.provider && r.provider !== "api") return toAgentLaunchCli(r.provider);

  if (r.availability.opencode) return "opencode";
  if (r.availability["cursor-cli"]) return "cursor";
  if (r.availability["chatgpt-cli"]) return "chatgpt";
  return "opencode";
}

export function aiProviderLabel(id: AiProviderId): string {
  switch (id) {
    case "cursor-cli":
      return "Cursor CLI";
    case "chatgpt-cli":
      return "ChatGPT CLI";
    case "opencode":
      return "OpenCode";
    case "api":
      return "HTTP API";
  }
}
