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

// ANSI/terminal escape sequences are stripped in two passes so this source
// file stays plain ASCII (patterns are built from \u escapes, no embedded
// control chars). OSC sequences (window title etc.) run ESC ] ... up to a BEL
// (U+0007) or ST (ESC \) and may contain spaces, so they are removed first;
// then CSI and other short escape sequences.
const OSC_RE = new RegExp("\\u001B\\][^\\u0007\\u001B]*(?:\\u0007|\\u001B\\\\)", "g");
const CSI_RE = new RegExp(
  "[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]",
  "g",
);
// Leftover control chars (bell, backspace, vertical tab, etc.). Tab (U+0009),
// newline (U+000A) and carriage return (U+000D) are kept - \r is resolved below.
const OTHER_CONTROL_RE = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]", "g");

/**
 * Turn raw terminal bytes into readable plain text: drop ANSI escapes,
 * normalize CRLF, resolve carriage-return overwrites (progress bars rewrite a
 * line with `\r`, so keep only the text after the last `\r`), strip stray
 * control chars, and trim trailing whitespace per line.
 */
export function cleanTerminalOutput(raw: string): string {
  const noEsc = raw.replace(OSC_RE, "").replace(CSI_RE, "").replace(/\r\n/g, "\n");
  const lines = noEsc.split("\n").map((line) => {
    const lastCr = line.lastIndexOf("\r");
    const visible = lastCr === -1 ? line : line.slice(lastCr + 1);
    return visible.replace(OTHER_CONTROL_RE, "").replace(/\s+$/, "");
  });
  return lines.join("\n").replace(/\n+$/, "") + "\n";
}
