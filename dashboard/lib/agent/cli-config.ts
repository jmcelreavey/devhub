"use client";

/**
 * Client access to the agent CLI / AI provider handoff settings
 * (see `agent/cli-env.ts` + `ai/preference.ts`). Values live in `.env.local`
 * and are served by `/api/agent-cli`.
 */

export type AgentCli = "opencode" | "cursor" | "chatgpt";

/** Shared provider ids — keep in sync with `lib/ai/preference`. */
export type AiProviderId = "cursor-cli" | "chatgpt-cli" | "opencode" | "api";

export const DEFAULT_CURSOR_AGENT_MODEL = "cursor-grok-4.5-high";

export interface AgentCliConfig {
  cli: AgentCli;
  /** Canonical preference (`DEVHUB_AI_PROVIDER`); null when auto. */
  provider: AiProviderId | null;
  /** Blank → OpenCode uses its `opencode.json` default model. */
  opencodeModel: string;
  cursorModel: string;
  cursorAgentInstalled: boolean;
  chatgptCliInstalled: boolean;
  apiConfigured: boolean;
  opencodeInstalled: boolean;
}

export const AGENT_CLI_DEFAULTS: AgentCliConfig = {
  cli: "opencode",
  provider: null,
  opencodeModel: "",
  cursorModel: DEFAULT_CURSOR_AGENT_MODEL,
  cursorAgentInstalled: false,
  chatgptCliInstalled: false,
  apiConfigured: false,
  opencodeInstalled: false,
};

let cache: AgentCliConfig | null = null;
let inflight: Promise<AgentCliConfig> | null = null;

function sanitizeCli(raw: string | undefined): AgentCli {
  if (raw === "cursor") return "cursor";
  if (raw === "chatgpt") return "chatgpt";
  return "opencode";
}

function sanitizeProvider(raw: string | null | undefined): AiProviderId | null {
  if (raw === "cursor-cli" || raw === "chatgpt-cli" || raw === "opencode" || raw === "api") {
    return raw;
  }
  return null;
}

/** Map shared provider → launch CLI. `api` / auto keep the resolved `cli` field. */
export function launchCliFromProvider(
  provider: AiProviderId | null,
  fallback: AgentCli,
): AgentCli {
  if (provider === "cursor-cli") return "cursor";
  if (provider === "chatgpt-cli") return "chatgpt";
  if (provider === "opencode") return "opencode";
  return fallback;
}

function sanitize(raw: Partial<AgentCliConfig> | null | undefined): AgentCliConfig {
  const provider = sanitizeProvider(raw?.provider ?? null);
  const fallbackCli = sanitizeCli(raw?.cli);
  return {
    // Prefer DEVHUB_AI_PROVIDER over a stale DEVHUB_AGENT_CLI — otherwise
    // agentSkillCommand / openTerminal ignore the Setup switch.
    cli: launchCliFromProvider(provider, fallbackCli),
    provider,
    opencodeModel: raw?.opencodeModel?.trim() ?? "",
    cursorModel: raw?.cursorModel?.trim() || DEFAULT_CURSOR_AGENT_MODEL,
    cursorAgentInstalled: raw?.cursorAgentInstalled === true,
    chatgptCliInstalled: raw?.chatgptCliInstalled === true,
    apiConfigured: raw?.apiConfigured === true,
    opencodeInstalled: raw?.opencodeInstalled === true,
  };
}

/** Fetch (and cache) the settings. Falls back to defaults when offline. */
export function getAgentCliConfig(force = false): Promise<AgentCliConfig> {
  if (cache && !force) return Promise.resolve(cache);
  inflight ??= fetch("/api/agent-cli")
    .then((r) => (r.ok ? r.json() : null))
    .then((raw: Partial<AgentCliConfig> | null) => {
      cache = sanitize(raw ?? cache ?? AGENT_CLI_DEFAULTS);
      return cache;
    })
    .catch(() => cache ?? AGENT_CLI_DEFAULTS)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Persist changes to `.env.local` via the API and refresh the cache. */
export async function saveAgentCliConfig(
  update: Partial<Pick<AgentCliConfig, "cli" | "provider" | "opencodeModel" | "cursorModel">>,
): Promise<AgentCliConfig> {
  const r = await fetch("/api/agent-cli", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
  const body = (await r.json()) as Partial<AgentCliConfig> & { error?: string };
  if (!r.ok) throw new Error(body.error ?? "Could not save agent CLI settings");
  cache = sanitize(body);
  return cache;
}

/** Seed/override the cache directly (used by tests and post-save flows). */
export function setAgentCliConfigCache(config: AgentCliConfig | null): void {
  cache = config ? sanitize(config) : null;
}
