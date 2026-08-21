/**
 * Live terminal session registry for MCP `terminal_list` / `terminal_tail`.
 *
 * The dock POSTs heartbeats as tabs open/close/reattach. Logs stay on disk
 * via the PTY peer; this only tracks UI-visible metadata.
 */

import type { TerminalSessionKind } from "@/lib/terminal-meta";

export interface RegisteredTerminalSession {
  tabId: number;
  sessionId: string | null;
  label: string;
  cwd?: string;
  kind?: TerminalSessionKind;
  repoName?: string;
  status: "connecting" | "open" | "closed";
  busy: boolean;
  updatedAt: number;
}

const sessions = new Map<number, RegisteredTerminalSession>();
/** Idle shells stay listable — dock heartbeats; 30m covers long quiet sessions. */
const STALE_MS = 30 * 60 * 1_000;

function prune(): void {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.updatedAt > STALE_MS) sessions.delete(id);
  }
}

export function upsertTerminalSession(entry: RegisteredTerminalSession): void {
  sessions.set(entry.tabId, { ...entry, updatedAt: Date.now() });
}

export function removeTerminalSession(tabId: number): void {
  sessions.delete(tabId);
}

export function listRegisteredTerminalSessions(): RegisteredTerminalSession[] {
  prune();
  return [...sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function findRegisteredSession(sessionId: string): RegisteredTerminalSession | null {
  prune();
  for (const s of sessions.values()) {
    if (s.sessionId === sessionId) return s;
  }
  return null;
}
