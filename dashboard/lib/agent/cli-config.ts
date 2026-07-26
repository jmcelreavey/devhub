"use client";

/**
 * Client access to the agent CLI handoff settings (see `agent-cli-env.ts`).
 * Values live in `.env.local` (1Password-backed) and are served by
 * `/api/agent-cli`; this module caches them so the terminal command builders
 * can await the config once and reuse it.
 */

export type AgentCli = "opencode" | "cursor";

export const DEFAULT_CURSOR_AGENT_MODEL = "cursor-grok-4.5-high";

export interface AgentCliConfig {
  cli: AgentCli;
  /** Blank → OpenCode uses its `opencode.json` default model. */
  opencodeModel: string;
  cursorModel: string;
  cursorAgentInstalled: boolean;
}

export const AGENT_CLI_DEFAULTS: AgentCliConfig = {
  cli: "opencode",
  opencodeModel: "",
  cursorModel: DEFAULT_CURSOR_AGENT_MODEL,
  cursorAgentInstalled: false,
};

let cache: AgentCliConfig | null = null;
let inflight: Promise<AgentCliConfig> | null = null;

function sanitize(raw: Partial<AgentCliConfig> | null | undefined): AgentCliConfig {
  return {
    cli: raw?.cli === "cursor" ? "cursor" : "opencode",
    opencodeModel: raw?.opencodeModel?.trim() ?? "",
    cursorModel: raw?.cursorModel?.trim() || DEFAULT_CURSOR_AGENT_MODEL,
    cursorAgentInstalled: raw?.cursorAgentInstalled === true,
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
  update: Partial<Pick<AgentCliConfig, "cli" | "opencodeModel" | "cursorModel">>,
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
