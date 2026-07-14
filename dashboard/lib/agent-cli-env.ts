/**
 * Server-side agent CLI handoff settings — which CLI runs one-shot terminal
 * jobs (PR review, DX audit, labs, repo upstart) and optional model overrides.
 *
 * Stored in `.env.local` under managed keys (`DEVHUB_AGENT_CLI`,
 * `DEVHUB_AGENT_OPENCODE_MODEL`, `DEVHUB_AGENT_CURSOR_MODEL`) so values can be
 * populated by the 1Password `devhub` item like every other managed config.
 * Read/written via `/api/agent-cli` and the setup wizard.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readDashboardEnvLocalFile, resolveEnvValue } from "./dashboard-env-local";
import { EXTRA_PATH_SEGMENTS } from "./process-env";

export type AgentCli = "opencode" | "cursor";

/** Verify the exact slug with `cursor-agent --help` / the `/model` picker. */
export const DEFAULT_CURSOR_AGENT_MODEL = "cursor-grok-4.5-high";

export interface AgentCliSettings {
  cli: AgentCli;
  /** Blank → OpenCode uses its `opencode.json` default model. */
  opencodeModel: string;
  cursorModel: string;
}

export function normalizeAgentCli(raw: string | undefined): AgentCli {
  return raw?.trim().toLowerCase() === "cursor" ? "cursor" : "opencode";
}

export function readAgentCliSettings(): AgentCliSettings {
  const { overrides } = readDashboardEnvLocalFile();
  return {
    cli: normalizeAgentCli(resolveEnvValue("DEVHUB_AGENT_CLI", overrides)),
    opencodeModel: resolveEnvValue("DEVHUB_AGENT_OPENCODE_MODEL", overrides) ?? "",
    cursorModel:
      resolveEnvValue("DEVHUB_AGENT_CURSOR_MODEL", overrides) ?? DEFAULT_CURSOR_AGENT_MODEL,
  };
}

let cachedCursorAgentBin: string | null | undefined;

/**
 * Resolve the `cursor-agent` binary the same way `cursor-open.ts` resolves
 * `cursor`: login-shell `which` first (picks up the user's real PATH), then
 * known install dirs. Cached per process; gates the Cursor option in the UI.
 */
export function resolveCursorAgentBin(): string | null {
  if (cachedCursorAgentBin !== undefined) return cachedCursorAgentBin;
  const shellBin = process.env.SHELL || "/bin/sh";
  try {
    const resolved = execSync(`${shellBin} -l -c 'which cursor-agent'`, {
      encoding: "utf8",
      timeout: 5_000,
    }).trim();
    if (resolved && fs.existsSync(resolved)) {
      cachedCursorAgentBin = resolved;
      return cachedCursorAgentBin;
    }
  } catch {
    /* fall through to known install dirs */
  }
  for (const dir of EXTRA_PATH_SEGMENTS) {
    const candidate = path.join(dir, "cursor-agent");
    if (fs.existsSync(candidate)) {
      cachedCursorAgentBin = candidate;
      return cachedCursorAgentBin;
    }
  }
  cachedCursorAgentBin = null;
  return null;
}

export function isCursorAgentInstalled(): boolean {
  return resolveCursorAgentBin() !== null;
}
