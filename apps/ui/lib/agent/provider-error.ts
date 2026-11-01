import { stripAnsi } from "@/lib/text/inline-code";

export type ProviderErrorKind = "cursor-login" | "opencode-mcp" | "pi-prefix" | "generic";

export interface ProviderErrorView {
  kind: ProviderErrorKind;
  /** One plain line: what is wrong. */
  summary: string;
  /** What to do about it; may contain `backtick` commands. */
  hint: string;
  /** The log with terminal colour codes removed. */
  log: string;
}

const MAX_INLINE_ERROR = 160;

/**
 * Turn a raw agent start-up failure into a one-line summary and a next step.
 *
 * `provider` is the agent's display name ("Pi", "OpenCode"). Matching the Pi
 * hint against the message too would catch "api", "Copilot" or "pipe".
 */
export function describeProviderError(provider: string, rawError: string): ProviderErrorView {
  const log = stripAnsi(rawError).trim();
  const isCursor = /cursor/i.test(provider) || /cursor/i.test(log);
  const isPi = /^pi$/i.test(provider.trim()) || /pi-rustdex/i.test(log);
  if (isCursor && /auth|sign.?in|login/i.test(log)) {
    return { kind: "cursor-login", log, summary: `${provider} needs you to sign in.`, hint: "Sign in to the Cursor agent CLI in DevHub's terminal (inside WSL on Windows) with `agent login`, then try again." };
  }
  if (/mcp\.devhub/i.test(log)) {
    return { kind: "opencode-mcp", log, summary: `${provider}'s DevHub MCP entry is invalid.`, hint: "Repair it, then retry the agent. The original config is saved beside it as `opencode.json.devhub-backup`." };
  }
  if (isPi && /ENOENT|prefix|node_modules/i.test(log)) {
    return { kind: "pi-prefix", log, summary: `${provider} could not install its packages.`, hint: "Reinstall managed Paseo from Agents → Connection to use DevHub's writable tools directory, then retry Pi." };
  }
  const short = log.length > 0 && log.length < MAX_INLINE_ERROR && !log.includes("\n");
  return { kind: "generic", log, summary: short ? log : `${provider} couldn't start.`, hint: "Check the details below and Agents → Connection before retrying." };
}
