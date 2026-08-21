/**
 * Shared helpers for terminal session logs.
 *
 * The PTY peer (scripts/terminal-pty-server.ts) tees every byte of a session's
 * output to a per-session file on disk. That file is the source of truth for
 * "copy all output" - the browser's xterm scrollback is RAM-capped, but the
 * on-disk log keeps the full session. The /api/terminal/log route reads it back
 * and cleans it into plain text.
 *
 * Both the peer script and the API route resolve the log directory the same
 * way (they run on the same machine), so the shared logic lives here.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { cleanTerminalOutput } from "@/lib/terminal-ansi";

export { cleanTerminalOutput } from "@/lib/terminal-ansi";

/** Session ids are UUID v4 - validated before touching the filesystem. */
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where per-session logs live. Override with DEVHUB_TERMINAL_LOG_DIR; defaults
 * to a stable subdir of the OS temp dir so it survives across reconnects but
 * gets cleared by normal temp cleanup.
 */
export function terminalLogDir(): string {
  return process.env.DEVHUB_TERMINAL_LOG_DIR || path.join(os.tmpdir(), "devhub-terminal-logs");
}

export function isValidSessionId(id: string): boolean {
  return SESSION_ID_RE.test(id);
}

/**
 * Absolute path for a session's log, or null if the id is malformed (guards
 * against path traversal from a caller-supplied query param).
 */
export function terminalLogPath(sessionId: string): string | null {
  if (!isValidSessionId(sessionId)) return null;
  return path.join(terminalLogDir(), `${sessionId}.log`);
}

/** Cap for search + historical transcript views (live dock copy still reads the full file). */
export const SESSION_LOG_TAIL_BYTES = 2 * 1024 * 1024;

export interface SessionLogTail {
  sessionId: string;
  /** Cleaned lines from the on-disk tail (1-based indexes match search hits). */
  lines: string[];
  modifiedAt: number;
  /** True when the log file is larger than {@link SESSION_LOG_TAIL_BYTES}. */
  truncated: boolean;
}

/**
 * Read the tail of a session log, cleaned of ANSI — same window search uses so
 * line numbers from `/api/terminal/search` line up with the transcript viewer.
 */
export function readSessionLogTail(sessionId: string): SessionLogTail | null {
  const file = terminalLogPath(sessionId);
  if (!file) return null;
  try {
    const { size, mtimeMs } = fs.statSync(file);
    const start = Math.max(0, size - SESSION_LOG_TAIL_BYTES);
    const fd = fs.openSync(file, "r");
    let raw: string;
    try {
      const buf = Buffer.alloc(Math.min(size, SESSION_LOG_TAIL_BYTES));
      fs.readSync(fd, buf, 0, buf.length, start);
      raw = buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
    return {
      sessionId,
      lines: cleanTerminalOutput(raw).split("\n"),
      modifiedAt: mtimeMs,
      truncated: size > SESSION_LOG_TAIL_BYTES,
    };
  } catch {
    return null;
  }
}
