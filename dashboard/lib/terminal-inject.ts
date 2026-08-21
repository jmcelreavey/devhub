/**
 * Propose → confirm → inject control plane.
 *
 * Agents / MCP / UI never write raw stdin without a UI gate. Destructive
 * patterns force a modal; soft proposals use an inline chip the user can
 * edit, run, or deny.
 */

import type { TerminalSessionKind } from "@/lib/terminal-meta";

export const TERMINAL_PROPOSE_EVENT = "devhub:terminal-propose";
export const TERMINAL_FOCUS_EVENT = "devhub:terminal-focus";

/** Patterns that must never silent-inject — always modal. */
const DESTRUCTIVE_RE =
  /\b(rm\s+(-[a-zA-Z]*f|-[a-zA-Z]*r)|sudo\s+rm|mkfs|dd\s+if=|:\(\)\s*\{|shutdown|reboot|git\s+push\s+.*--force|git\s+reset\s+--hard|DROP\s+TABLE|kubectl\s+delete)\b/i;

export interface TerminalProposeDetail {
  /** Unique id (client or server proposal store). */
  id: string;
  command: string;
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
  /** Prefer a dedicated Agent tab so we don't stomp long-running devservers. */
  preferAgentTab?: boolean;
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
}

export interface TerminalFocusDetail {
  cwd?: string;
  label?: string;
  kind?: TerminalSessionKind;
  repoName?: string;
  /** Open a new tab when no match. */
  createIfMissing?: boolean;
  command?: string;
}

export function isDestructiveTerminalCommand(command: string): boolean {
  return DESTRUCTIVE_RE.test(command);
}

/** Soft busy heuristic: recent PTY output or recent stdin = busy. */
export function isTerminalBusy(opts: {
  lastOutputAt: number | null;
  lastInputAt: number | null;
  now?: number;
  /** Quiet window before we call the shell idle (ms). */
  idleMs?: number;
}): boolean {
  const now = opts.now ?? Date.now();
  const idleMs = opts.idleMs ?? 1_200;
  const last = Math.max(opts.lastOutputAt ?? 0, opts.lastInputAt ?? 0);
  if (last <= 0) return false;
  return now - last < idleMs;
}

export function newTerminalProposeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `propose-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
export function wrapQuietAgentRun(command: string): string {
  const body = command.trim();
  return `{ ${body}; }`;
}
