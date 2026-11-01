/**
 * Server-side agent CLI handoff settings — which CLI runs one-shot terminal
 * jobs (PR review, DX audit, labs, repo upstart) and optional model overrides.
 *
 * Stored in `.env.local` under managed keys (`DEVHUB_AI_PROVIDER`,
 * `DEVHUB_AGENT_CLI`, `DEVHUB_AGENT_OPENCODE_MODEL`, `DEVHUB_AGENT_CURSOR_MODEL`,
 * `DEVHUB_AGENT_ANTIGRAVITY_MODEL`)
 * so values can be populated by the 1Password `devhub` item like every other
 * managed config. Read/written via `/api/agent-cli` and the setup wizard.
 */

import fs from "node:fs";
import path from "node:path";
import { readDashboardEnvLocalFile, resolveEnvValue } from "../dashboard-env-local";
import { execExternal } from "../exec-external";
import { EXTRA_PATH_SEGMENTS } from "../../local/process-env";

export type AgentCli = "opencode" | "cursor" | "chatgpt" | "antigravity";

/** Verify the exact slug with `cursor-agent --help` / the `/model` picker. */
export const DEFAULT_CURSOR_AGENT_MODEL = "cursor-grok-4.5-high";

export interface AgentCliSettings {
  cli: AgentCli;
  /** Blank → OpenCode uses its `opencode.json` default model. */
  opencodeModel: string;
  cursorModel: string;
  antigravityModel: string;
}

export function normalizeAgentCli(raw: string | undefined): AgentCli {
  const v = raw?.trim().toLowerCase();
  if (v === "opencode") return "opencode";
  if (v === "chatgpt" || v === "codex") return "chatgpt";
  if (v === "antigravity" || v === "agy") return "antigravity";
  // Cursor is the default, matching resolveAiProvider's fallback order.
  return "cursor";
}

/**
 * Map `DEVHUB_AI_PROVIDER` → launch CLI. Kept local to avoid a circular import
 * with `lib/ai/preference` (which probes cursor-agent via this module).
 */
function agentCliFromAiProviderEnv(raw: string | undefined): AgentCli | null {
  const v = raw?.trim().toLowerCase();
  if (v === "cursor-cli" || v === "cursor") return "cursor";
  if (v === "chatgpt-cli" || v === "chatgpt" || v === "codex") return "chatgpt";
  if (v === "antigravity-cli" || v === "antigravity" || v === "agy") return "antigravity";
  if (v === "opencode") return "opencode";
  return null;
}

export function readAgentCliSettings(): AgentCliSettings {
  const { overrides } = readDashboardEnvLocalFile();
  const fromProvider = agentCliFromAiProviderEnv(
    resolveEnvValue("DEVHUB_AI_PROVIDER", overrides),
  );
  return {
    cli: fromProvider ?? normalizeAgentCli(resolveEnvValue("DEVHUB_AGENT_CLI", overrides)),
    opencodeModel: resolveEnvValue("DEVHUB_AGENT_OPENCODE_MODEL", overrides) ?? "",
    cursorModel:
      resolveEnvValue("DEVHUB_AGENT_CURSOR_MODEL", overrides) ?? DEFAULT_CURSOR_AGENT_MODEL,
    antigravityModel: resolveEnvValue("DEVHUB_AGENT_ANTIGRAVITY_MODEL", overrides) ?? "",
  };
}

let cachedCursorAgentBin: Promise<string | null> | undefined;

/**
 * Resolve the `cursor-agent` binary the same way `cursor-open.ts` resolves
 * `cursor`: login-shell `which` first (picks up the user's real PATH), then
 * known install dirs. Cached per process; gates the Cursor option in the UI.
 */
export function resolveCursorAgentBin(): Promise<string | null> {
  cachedCursorAgentBin ??= findCursorAgentBin();
  return cachedCursorAgentBin;
}

async function findCursorAgentBin(): Promise<string | null> {
  const shellBin = process.env.SHELL || "/bin/sh";
  try {
    const { stdout } = await execExternal(shellBin, ["-l", "-c", "which cursor-agent"], {
      timeoutMs: 5_000,
      label: "cursor-agent:which",
    });
    const resolved = stdout.trim();
    if (resolved && fs.existsSync(resolved)) return resolved;
  } catch {
    /* fall through to known install dirs */
  }
  for (const dir of EXTRA_PATH_SEGMENTS) {
    const candidate = path.join(dir, "cursor-agent");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export async function isCursorAgentInstalled(): Promise<boolean> {
  return (await resolveCursorAgentBin()) !== null;
}
