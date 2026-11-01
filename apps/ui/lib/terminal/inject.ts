import { newTerminalProposeId } from "@shared/terminal/command";
export { hasUnbalancedShellQuotes, isDestructiveTerminalCommand, newTerminalProposeId } from "@shared/terminal/command";

/**
 * Propose → confirm → inject control plane.
 *
 * Agents / MCP / UI never write raw stdin without a UI gate. Destructive
 * patterns force a modal; soft proposals use an inline chip the user can
 * edit, run, or deny.
 */

import type { HostApprovalRequest } from "@contracts/plugin-runtime";
import type { TerminalSessionKind } from "../../../../packages/shared/ui-lib/terminal/meta";
import { INJECT_EXIT_TAG } from "@/lib/terminal/blocks";

export const TERMINAL_PROPOSE_EVENT = "devhub:terminal-propose";
export const TERMINAL_FOCUS_EVENT = "devhub:terminal-focus";

export interface TerminalProposeDetail {
  /** Unique id (client or server proposal store). */
  id: string;
  command: string;
  hostApproval?: HostApprovalRequest;
  cwd?: string;
  label?: string;
  /**
   * Human-facing chip copy (e.g. "Review PR #123 with Cursor").
   * Prefer this over dumping the raw CLI in the default view.
   */
  summary?: string;
  /** Product name for status strip ("Cursor", not "cursor-agent"). */
  providerLabel?: string;
  kind?: TerminalSessionKind;
  repoName?: string;
  /** Short reason shown in the chip/modal (MCP / agent source). */
  reason?: string;
  /** Source for audit UX. */
  source?: "ui" | "mcp" | "agent-job";
  /** oneshot = structured wrap; interactive = raw agent TUI — don't reuse those tabs. */
  mode?: "oneshot" | "interactive";
  /**
   * When true, skip the chip and inject immediately after tab open
   * (only for trusted first-party UI that already confirmed via prompt()).
   */
  skipConfirm?: boolean;
  requiresConfirmation?: boolean;
}

export interface TerminalFocusDetail {
  cwd?: string;
  label?: string;
  kind?: TerminalSessionKind;
  repoName?: string;
  command?: string;
}

/**
 * Busy detection. Prefers the OSC 133 command lifecycle when live shell
 * integration marks have been seen; otherwise falls back to an activity
 * heuristic that knows an idle prompt repainting itself (p10k/starship
 * clock segments redraw every second) is not a running command.
 */
export function isTerminalBusy(opts: {
  lastOutputAt: number | null;
  lastInputAt: number | null;
  now?: number;
  /** Quiet window before we call the shell idle (ms). */
  idleMs?: number;
  /**
   * OSC 133 lifecycle when shell integration is live: true between
   * command-start (C) and command-done (D/next prompt). Null/undefined when
   * no live marks have been seen — heuristic applies.
   */
  commandRunning?: boolean | null;
  /**
   * Heuristic escape hatch: the last buffer line looks like a shell prompt.
   * Lazy so callers don't serialize the viewport on every output chunk.
   */
  promptVisible?: boolean | (() => boolean);
  /** Minimum quiet gap before promptVisible may override recent output (ms). */
  promptIdleMs?: number;
}): boolean {
  const now = opts.now ?? Date.now();
  const idleMs = opts.idleMs ?? 1_200;
  const lastInput = opts.lastInputAt ?? 0;
  const recentInput = lastInput > 0 && now - lastInput < idleMs;
  if (opts.commandRunning != null) return opts.commandRunning || recentInput;
  const lastOutput = opts.lastOutputAt ?? 0;
  const last = Math.max(lastOutput, lastInput);
  if (last <= 0) return false;
  if (now - last >= idleMs) return false;
  // Recent output, but the stream has paused and a prompt is on screen —
  // that's a prompt repaint, not a command. Without this an RPROMPT clock
  // kept the shell "busy" forever and every inject timed out.
  const promptIdleMs = opts.promptIdleMs ?? 250;
  if (!recentInput && lastOutput > 0 && now - lastOutput >= promptIdleMs) {
    const promptVisible =
      typeof opts.promptVisible === "function" ? opts.promptVisible() : opts.promptVisible;
    if (promptVisible) return false;
  }
  return true;
}

/** Dispatch a propose event for TerminalDock to confirm + inject. */
export function proposeTerminalRun(detail: Omit<TerminalProposeDetail, "id"> & { id?: string }): string {
  const id = detail.id ?? newTerminalProposeId();
  if (typeof window === "undefined") return id;
  const payload: TerminalProposeDetail = { ...detail, id };
  window.dispatchEvent(new CustomEvent(TERMINAL_PROPOSE_EVENT, { detail: payload }));
  return id;
}

export function focusTerminalTab(detail: TerminalFocusDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TERMINAL_FOCUS_EVENT, { detail }));
}

/**
 * Format a confirmed command for PTY write.
 * Multi-line uses bracketed paste so zsh/bash don't treat embedded newlines
 * as fragile quoted-newline line-editor input.
 */
export function formatTerminalInjectPayload(command: string): string {
  const raw = command.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const trimmedEnd = raw.replace(/\n+$/, "");
  if (trimmedEnd.includes("\n")) {
    return `\x1b[200~${trimmedEnd}\x1b[201~\r`;
  }
  return `${trimmedEnd}\r`;
}

/**
 * Wrap a one-shot so the PTY prints a clear banner + exit code.
 * Keep shell wrapping minimal — documented escape hatch, not a framework.
 *
 * // lean-ctx: stdlib, upgrade when native agent job API covers all CLIs
 */
export function wrapStructuredTerminalRun(command: string, opts?: { title?: string }): string {
  const title = (opts?.title ?? "DevHub run").replace(/'/g, "'\"'\"'");
  const body = command.trim();
  return [
    `printf '\\n\\033[90m── %s ──\\033[0m\\n' '${title}'`,
    `{ ${body}; }`,
    `_dh_ec=$?`,
    `printf '\\n\\033[90m── exit %s ──\\033[0m\\n' "$_dh_ec"`,
    `unset _dh_ec`,
  ].join("; ");
}

/**
 * Group a one-shot so the dock's quiet inject can clear + restore echo around it.
 * Viewport clear lives in the inject path — wrapping it here double-flashed `clear`.
 */
/**
 * The quiet inject line: clear, run, restore echo. A shell without OSC 133
 * integration never reports the exit, so `reportExit` makes the line emit a
 * tagged `133;D;<code>` itself (invisible; the tag keeps it from looking like
 * integration).
 */
export function quietInjectCommand(command: string, reportExit: boolean): string {
  const run = `printf '\\033[2J\\033[H'; ${command}`;
  if (!reportExit) return `${run}; stty echo 2>/dev/null || true`;
  return `${run}; _dh_rc=$?; stty echo 2>/dev/null || true; printf '\\033]133;D;%s;${INJECT_EXIT_TAG}\\007' "$_dh_rc"; unset _dh_rc`;
}

export function wrapQuietAgentRun(command: string): string {
  const body = command.trim();
  return `{ ${body}; }`;
}
