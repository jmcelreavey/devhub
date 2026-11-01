/** Patterns that must never silent-inject — always modal. */
const DESTRUCTIVE_RE =
  /\b(rm\s+(-[a-zA-Z]*f|-[a-zA-Z]*r)|sudo\s+rm|mkfs|dd\s+if=|:\(\)\s*\{|shutdown|reboot|git\s+push\s+.*--force|git\s+reset\s+--hard|DROP\s+TABLE|kubectl\s+delete)\b/i;

export function isDestructiveTerminalCommand(command: string): boolean {
  return DESTRUCTIVE_RE.test(command);
}

/**
 * True when a command would leave the shell stuck at a `quote>` / `dquote>`
 * continuation: unbalanced quotes or a trailing backslash. Used to refuse
 * agent-produced commands before they ever reach the PTY.
 */
export function hasUnbalancedShellQuotes(command: string): boolean {
  let state: "plain" | "single" | "double" = "plain";
  let escaped = false;
  for (const ch of command) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (state === "single") {
      if (ch === "'") state = "plain";
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (state === "double") {
      if (ch === '"') state = "plain";
      continue;
    }
    if (ch === "'") state = "single";
    else if (ch === '"') state = "double";
  }
  return state !== "plain" || escaped;
}

export function newTerminalProposeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `propose-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

