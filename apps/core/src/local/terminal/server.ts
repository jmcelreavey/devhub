#!/usr/bin/env tsx
/**
 * Terminal peer — a WebSocket-fronted PTY on TERMINAL_PORT (default 1339).
 *
 * Each browser connection spawns a shell rooted at the developer directory
 * (~/Developer) and relays bytes both ways. The terminal client
 * (components/shell/WTermSession.tsx) discovers the peer port from the dashboard.
 *
 * Shell modes (client picks via `?shell=` on the WS URL):
 * - `login` — $SHELL -l, full rc files. The real environment.
 * - `safe`  — rc files skipped (zsh -f / bash --norc), for explicit recovery.
 * - `bash`  — plain /bin/bash --norc -i.
 *
 * A quiet startup may be waiting for a macOS or password-manager prompt.
 * Keep that shell alive; replacing it with safe mode discards the user's rc
 * files and can interrupt authentication before they respond.
 *
 * Soft disconnect / reattach: when the WebSocket closes without an explicit
 * `dispose` control frame (dashboard HMR, webview reload), the PTY is parked
 * for ORPHAN_TTL_MS. A later connection with `?attach=<sessionId>` rebinds to
 * the same shell and replays a tail of the on-disk log into the new terminal.
 *
 * SECURITY: this hands out an interactive login shell, so "bound to localhost"
 * is not on its own a control. Any process on the machine can reach loopback,
 * and any web page the user visits can make a browser open a WebSocket to it.
 *
 * Two checks close that, and both are required in the desktop app:
 *
 * - **Loopback origin.** The handshake's `Origin` must be a loopback host — a
 *   remote page cannot forge it, and `SameSite` cookie rules are not reliably
 *   applied to WebSocket handshakes, so the origin cannot be skipped. The port
 *   is not pinned: any local dashboard (packaged app, checkout on a spare port)
 *   may reuse whichever peer is already listening.
 * - **Bootstrap cookie.** The per-launch token the Tauri shell set. A page on
 *   another origin cannot send it and script cannot read it.
 *
 * In checkout/dev mode there is no token, so only the origin check applies —
 * the same posture as before, but no longer the *only* thing standing between
 * a website and a shell in the shipped product.
 *
 * The port stays on loopback.
 */
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket, type RawData } from "ws";
import type { IncomingMessage } from "node:http";
import * as pty from "node-pty";
import { isValidSessionId, terminalLogDir, terminalLogPath } from "./log";
import {
  isAllowedTerminalOrigin,
  isDesktopSession,
  isValidTerminalTicket,
} from "./bootstrap-auth";
import { packagedToolDirs, terminalShellEnv } from "../process-env";
import { terminalPort } from "./port";
import { zshStartupFiles } from "../../../../../packages/shared/process/zsh-startup";

const terminalEnv = { ...process.env };
const PORT = terminalPort(terminalEnv);
/** Session logs older than this are pruned on startup. */
const LOG_TTL_MS = 3 * 24 * 60 * 60 * 1_000;
/**
 * How long a PTY survives after the UI drops the WebSocket without disposing.
 * Long enough to cover Next/Tauri reloads; short enough not to leak shells.
 */
const ORPHAN_TTL_MS = 15 * 60 * 1_000;
/** Bytes of on-disk transcript replayed into a reattached terminal. */
const REATTACH_REPLAY_BYTES = 512 * 1024;

/**
 * Ensure the log directory exists and drop stale session logs. The full output
 * of each session is tee'd here so the dashboard can "copy all output" without
 * being limited by the browser's in-memory scrollback.
 */
function initLogDir(): void {
  const dir = terminalLogDir(terminalEnv);
  try {
    // Session transcripts are plaintext, so the directory shouldn't be
    // listable by other users even though the files are 0600.
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700); // mkdirSync's mode is ignored when the dir exists
    const now = Date.now();
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".log")) continue;
      const file = path.join(dir, name);
      try {
        if (now - fs.statSync(file).mtimeMs > LOG_TTL_MS) fs.unlinkSync(file);
      } catch {
        /* ignore individual file errors */
      }
    }
  } catch (err) {
    log(`could not prepare log dir ${dir}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

type ShellMode = "login" | "safe" | "bash";

function log(msg: string): void {
  process.stdout.write(`[terminal] ${msg}\n`);
}

/** The configured developer directory, with safe fallbacks. */
function developerDir(): string {
  const candidates = [
    process.env.DEVHUB_DEVELOPER_DIR,
    path.join(os.homedir(), "Developer"),
    os.homedir(),
  ].filter((p): p is string => Boolean(p));
  for (const dir of candidates) {
    try {
      if (fs.statSync(dir).isDirectory()) return dir;
    } catch {
      /* try next */
    }
  }
  return process.cwd();
}

interface ShellCommand {
  cmd: string;
  args: string[];
}

function userShell(): string {
  if (process.env.DEVHUB_TERMINAL_SHELL) return process.env.DEVHUB_TERMINAL_SHELL;
  if (process.platform === "win32") return process.env.COMSPEC ?? "powershell.exe";
  return process.env.SHELL ?? "/bin/zsh";
}

function shellCommand(mode: ShellMode): ShellCommand {
  if (process.platform === "win32") return { cmd: userShell(), args: [] };
  const override = process.env.DEVHUB_TERMINAL_ARGS?.trim();
  switch (mode) {
    case "safe": {
      const shell = userShell();
      // -f skips rc files in zsh; bash spells it --norc.
      const args = shell.includes("bash") ? ["--norc", "-i"] : ["-f", "-i"];
      return { cmd: shell, args };
    }
    case "bash":
      return { cmd: "/bin/bash", args: ["--norc", "-i"] };
    case "login":
    default:
      return { cmd: userShell(), args: override ? override.split(/\s+/) : ["-l"] };
  }
}

/**
 * A clean shell env: inherit PATH/HOME/etc. but strip the npm/Next lifecycle
 * noise and DevHub's own npm prefix, so subshells start from a normal slate.
 */
function shellEnv(): Record<string, string> {
  const env = terminalShellEnv(process.env, packagedToolDirs(process.env, os.homedir()));
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  env.LANG = process.env.LANG ?? "en_US.UTF-8";
  env.DEVHUB_TERMINAL = "1";
  return env;
}

/** Control messages from the client are JSON; everything else is raw stdin. */
interface ResizeMessage {
  type: "resize";
  cols: number;
  rows: number;
}

function isResize(value: unknown): value is ResizeMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "resize" &&
    typeof (value as ResizeMessage).cols === "number" &&
    typeof (value as ResizeMessage).rows === "number"
  );
}

function isDispose(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "dispose";
}

/** Server→client control frame. The client filters these out of the stream. */
function sendCtl(socket: WebSocket, payload: Record<string, unknown>): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ devhubCtl: true, ...payload }));
  }
}

function requestedMode(req: IncomingMessage): ShellMode {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const mode = url.searchParams.get("shell");
    if (mode === "safe" || mode === "bash" || mode === "login") return mode;
  } catch {
    /* default below */
  }
  return "login";
}

/**
 * Optional `?cwd=` start directory (e.g. a repo from the Repos page).
 * Must exist, be a directory, and live under the user's home — anything
 * else falls back to the developer dir.
 */
function requestedCwd(req: IncomingMessage): string | null {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const raw = url.searchParams.get("cwd");
    if (!raw) return null;
    const resolved = path.resolve(raw);
    const home = os.homedir();
    if (!resolved.startsWith(home + path.sep) && resolved !== home) return null;
    if (!fs.statSync(resolved).isDirectory()) return null;
    return resolved;
  } catch {
    return null;
  }
}

/**
 * Optional `?attach=<uuid>` to rebind to an orphaned PTY after a UI remount.
 */
function requestedAttach(req: IncomingMessage): string | null {
  try {
    const raw = new URL(req.url ?? "/", "http://localhost").searchParams.get("attach");
    if (!raw || !isValidSessionId(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

/* ── Shell integration ──────────────────────────────────────────────────────
 * Warp-style command blocks need OSC 133 marks (A=prompt, C=execute,
 * D;<code>=done). Rather than hoping the user's rc files emit them, we
 * intercept .zshrc the way VS Code does: spawn zsh with ZDOTDIR pointed at a
 * temp dir whose .zshrc sources the user's real rc, then loads our hooks.
 * This avoids stdin-injection echo races entirely and works on stock zsh.
 *
 * Opt out with DEVHUB_TERMINAL_SHELL_INTEGRATION=0.
 */
const SHELL_INTEGRATION_DIR = path.join(
  os.tmpdir(),
  `devhub-terminal-integration-${process.pid}`,
);

function shellIntegrationEnabled(): boolean {
  return process.env.DEVHUB_TERMINAL_SHELL_INTEGRATION !== "0";
}

/** The hook definitions sourced by the intercepted .zshrc. */
function integrationZsh(): string {
  return `# DevHub terminal shell integration (OSC 133)
(( \${+functions[__devhub_precmd]} )) && return
typeset -g __devhub_first_prompt=1
__devhub_precmd() {
  # MUST be the first line: $? is the exit status of the last command, and
  # anything here clobbers it — including the (( )) below, which returns 1
  # whenever its expression evaluates to zero. Reading $? inside the else
  # branch reported exit code 1 for every successful command.
  local __devhub_status=$?
  if (( __devhub_first_prompt )); then
    __devhub_first_prompt=0
  else
    printf '\\e]133;D;%s\\a' $__devhub_status
  fi
  printf '\\e]133;A\\a'
}
__devhub_preexec() { printf '\\e]133;C\\a'; }
# Prepended, not appended: our hooks.zsh is sourced after the user's rc, so
# precmd_functions already holds theirs (p10k et al). Running last would mean
# reading $? after someone else's precmd had already overwritten it.
precmd_functions=(__devhub_precmd $precmd_functions)
preexec_functions+=(__devhub_preexec)
`;
}

/**
 * Write the integration tree: <dir>/hooks.zsh plus <dir>/zdotdir/.zshrc, which
 * chains to the user's real rc (USER_ZDOTDIR points back at the original).
 */
function initShellIntegration(): void {
  if (!shellIntegrationEnabled()) return;
  try {
    const zdotdir = path.join(SHELL_INTEGRATION_DIR, "zdotdir");
    fs.mkdirSync(zdotdir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(SHELL_INTEGRATION_DIR, "hooks.zsh"), integrationZsh(), {
      mode: 0o600,
    });
    for (const [file, content] of Object.entries(zshStartupFiles())) {
      fs.writeFileSync(path.join(zdotdir, file), content, { mode: 0o600 });
    }
  } catch (err) {
    log(`shell integration unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** True when this spawn should get the intercepted ZDOTDIR. */
function wantsShellIntegration(mode: ShellMode): boolean {
  return shellIntegrationEnabled() && mode === "login" && userShell().includes("zsh");
}

function readRawLogTail(logFile: string | null): Buffer | null {
  if (!logFile) return null;
  try {
    const { size } = fs.statSync(logFile);
    if (size <= 0) return null;
    const start = Math.max(0, size - REATTACH_REPLAY_BYTES);
    const length = size - start;
    const fd = fs.openSync(logFile, "r");
    try {
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, start);
      return buf;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/**
 * Reject a handshake that cannot prove it came from the dashboard window.
 *
 * `verifyClient` runs before the socket is upgraded, so a rejected connection
 * never reaches `pty.spawn` — the shell is not started and then killed, it is
 * never started.
 */
function verifyTerminalClient(req: IncomingMessage): { ok: true } | { ok: false; reason: string } {
  if (!isAllowedTerminalOrigin(req.headers.origin)) {
    return {
      ok: false,
      reason: `origin ${req.headers.origin ?? "(none)"} (loopback origins only)`,
    };
  }

  // Desktop only: in a checkout there is no shell and therefore no token, and
  // requiring one would break `npm run dev` for no gain.
  //
  // A ticket, not the cookie. WKWebView does not attach the bootstrap cookie to
  // a `ws://` handshake on a different port, so the original cookie check
  // rejected every connection in the shipped app — the terminal simply did not
  // work. The dashboard fetches a ticket over same-origin HTTP, where the
  // cookie does work, and passes it here.
  if (isDesktopSession()) {
    let ticket: string | null = null;
    try {
      ticket = new URL(req.url ?? "/", "http://localhost").searchParams.get("ticket");
    } catch {
      /* unparseable URL — treated as no ticket */
    }
    if (!isValidTerminalTicket(ticket)) {
      return { ok: false, reason: "missing or expired terminal ticket" };
    }
  }

  return { ok: true };
}

interface PtySession {
  sessionId: string;
  cwd: string;
  term: pty.IPty | null;
  logFile: string | null;
  logStream: fs.WriteStream | null;
  cols: number;
  rows: number;
  orphanTimer: ReturnType<typeof setTimeout> | null;
  socket: WebSocket | null;
  /** Explicit client dispose (close tab / restart) — kill instead of orphan. */
  disposeRequested: boolean;
  closed: boolean;
  /** Shell integration (OSC 133 hooks) was injected at spawn. */
  integrated: boolean;
}

const sessions = new Map<string, PtySession>();

function clearOrphanTimer(session: PtySession): void {
  if (session.orphanTimer) {
    clearTimeout(session.orphanTimer);
    session.orphanTimer = null;
  }
}

function destroySession(session: PtySession, reason: string): void {
  if (session.closed) return;
  session.closed = true;
  clearOrphanTimer(session);
  sessions.delete(session.sessionId);
  if (session.term) log(`session ended (${reason}, pid: ${session.term.pid})`);
  try {
    session.term?.kill();
  } catch {
    /* already gone */
  }
  session.term = null;
  try {
    session.logStream?.end();
  } catch {
    /* ignore */
  }
  session.logStream = null;
  session.socket = null;
}

function bindSocket(session: PtySession, socket: WebSocket, { reattached, wterm }: { reattached: boolean; wterm: boolean }): void {
  clearOrphanTimer(session);
  session.socket = socket;
  session.disposeRequested = false;

  if (reattached) {
    sendCtl(socket, {
      type: "session",
      mode: "reattached",
      shell: "",
      cwd: session.cwd,
      sessionId: session.sessionId,
      reattached: true,
      integrated: session.integrated,
    });
    const replay = readRawLogTail(session.logFile);
    if (replay && socket.readyState === socket.OPEN) {
      socket.send(replay.toString("utf8"));
    }
    if (socket.readyState === socket.OPEN) {
      socket.send("\r\n\x1b[90m[reattached to running session]\x1b[0m\r\n");
    }
    if (wterm) sendCtl(socket, { type: "replay-end" });
  }

  socket.on("message", (raw: RawData, isBinary: boolean) => {
    let text: string;
    if (isBinary) {
      // The transport may send text as binary; WTT1 marks validated UTF-8.
      // WTB1 carries exactly one X10 report, without UTF-8 conversion.
      const size = Array.isArray(raw) ? raw.reduce((n, part) => n + part.length, 0) : raw.byteLength;
      if (!wterm || size < 4 || size > 1024 * 1024 + 4) {
        socket.close(1008, "Invalid binary input");
        return;
      }
      const frame = Array.isArray(raw) ? Buffer.concat(raw) : raw instanceof ArrayBuffer ? Buffer.from(raw) : raw;
      if (frame[0] === 0x57 && frame[1] === 0x54 && frame[2] === 0x54 && frame[3] === 1) {
        try {
          text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(frame.subarray(4));
        } catch {
          socket.close(1008, "Invalid binary input");
          return;
        }
      } else if (size === 10 && frame[0] === 0x57 && frame[1] === 0x54 && frame[2] === 0x42 && frame[3] === 1 &&
          frame[4] === 0x1b && frame[5] === 0x5b && frame[6] === 0x4d &&
          frame[7] >= 0x20 && frame[8] >= 0x20 && frame[9] >= 0x20) {
        session.term?.write(frame.subarray(4));
        return;
      } else {
        socket.close(1008, "Invalid binary input");
        return;
      }
    } else {
      text = raw.toString();
    }
    if (text.startsWith("{")) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (isDispose(parsed)) {
          session.disposeRequested = true;
          try {
            socket.close();
          } catch {
            /* ignore */
          }
          destroySession(session, "dispose");
          return;
        }
        if (isResize(parsed)) {
          session.cols = Math.max(1, parsed.cols);
          session.rows = Math.max(1, parsed.rows);
          session.term?.resize(session.cols, session.rows);
          return;
        }
      } catch {
        /* not JSON — fall through to raw input */
      }
    }
    session.term?.write(text);
  });

  socket.on("close", () => {
    if (session.closed) return;
    // A newer socket may have already taken over (reattach).
    if (session.socket !== socket) return;
    session.socket = null;
    if (session.disposeRequested) {
      destroySession(session, "dispose");
      return;
    }
    // Soft disconnect — keep the PTY alive for a UI remount/reattach.
    clearOrphanTimer(session);
    log(`session orphaned (pid: ${session.term?.pid ?? "?"}, ttl ${ORPHAN_TTL_MS}ms)`);
    session.orphanTimer = setTimeout(() => {
      destroySession(session, "orphan-ttl");
    }, ORPHAN_TTL_MS);
  });
}

function spawnShell(session: PtySession, mode: ShellMode): void {
  const { cmd, args } = shellCommand(mode);

  // Chain every startup file, restoring the user's ZDOTDIR while their config runs.
  const spawnEnv = shellEnv();
  // Lets a process in the tab (the agent runner) report which tab it lives in.
  spawnEnv.DEVHUB_TERMINAL_SESSION_ID = session.sessionId;
  const integrated = wantsShellIntegration(mode);
  if (integrated) {
    spawnEnv.USER_ZDOTDIR = process.env.ZDOTDIR ?? os.homedir();
    spawnEnv.DEVHUB_USER_ZDOTDIR_SET = process.env.ZDOTDIR === undefined ? "0" : "1";
    spawnEnv.ZDOTDIR = path.join(SHELL_INTEGRATION_DIR, "zdotdir");
  }

  const t = pty.spawn(cmd, args, {
    name: "xterm-256color",
    cols: session.cols,
    rows: session.rows,
    cwd: session.cwd,
    env: spawnEnv,
  });
  session.term = t;
  session.integrated = integrated;
  log(`session started (mode: ${mode}, shell: ${cmd} ${args.join(" ")}, pid: ${t.pid})`);
  if (session.socket) {
    sendCtl(session.socket, {
      type: "session",
      mode,
      shell: `${cmd} ${args.join(" ")}`.trim(),
      cwd: session.cwd,
      sessionId: session.sessionId,
      reattached: false,
      integrated,
    });
  }

  t.onData((data) => {
    session.logStream?.write(data);
    const socket = session.socket;
    if (socket && socket.readyState === socket.OPEN) {
      socket.send(data);
    }
  });

  t.onExit(({ exitCode }) => {
    if (session.closed || session.term !== t) return;
    const socket = session.socket;
    if (socket && socket.readyState === socket.OPEN) {
      socket.send(`\r\n\x1b[90m[process exited — code ${exitCode}]\x1b[0m\r\n`);
      sendCtl(socket, { type: "exited", exitCode });
    }
  });

}

function createSession(cwd: string, mode: ShellMode, socket: WebSocket, wterm: boolean): PtySession {
  const sessionId = randomUUID();
  const logFile = terminalLogPath(sessionId, terminalEnv);
  let logStream: fs.WriteStream | null = null;
  if (logFile) {
    try {
      // 0600: these logs are a verbatim transcript of an interactive shell, so
      // anything you paste — tokens, `op read` output, kubectl secrets — lands
      // here in plaintext for the LOG_TTL_MS window. Owner-only is the least we
      // can do; the retention window is the thing to shorten if that bothers you.
      logStream = fs.createWriteStream(logFile, { flags: "a", mode: 0o600 });
      logStream.on("error", (err) => {
        log(`log write error (${sessionId}): ${err.message}`);
        logStream = null;
      });
    } catch (err) {
      log(`could not open log ${logFile}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const session: PtySession = {
    sessionId,
    cwd,
    term: null,
    logFile,
    logStream,
    cols: 80,
    rows: 24,
    orphanTimer: null,
    socket: null,
    disposeRequested: false,
    closed: false,
    integrated: false,
  };
  sessions.set(sessionId, session);
  bindSocket(session, socket, { reattached: false, wterm });
  spawnShell(session, mode);
  return session;
}

const wss = new WebSocketServer({
  host: "127.0.0.1",
  port: PORT,
  verifyClient: ({ req }, done) => {
    const result = verifyTerminalClient(req);
    if (result.ok) {
      done(true);
      return;
    }
    log(`rejected connection: ${result.reason}`);
    done(false, 403, "Forbidden");
  },
});

wss.on("listening", () => {
  initLogDir();
  initShellIntegration();
  log(`PTY server listening on ws://127.0.0.1:${PORT} (cwd: ${developerDir()})`);
  log(`session logs: ${terminalLogDir(terminalEnv)}`);
});

wss.on("error", (err: unknown) => {
  log(`server error: ${err instanceof Error ? err.message : String(err)}`);
});

wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
  let wterm = false;
  let strictAttach = false;
  try {
    const params = new URL(req.url ?? "/", "http://localhost").searchParams;
    wterm = params.get("engine") === "wterm";
    strictAttach = wterm && params.get("strictAttach") === "1";
  } catch {
    socket.close(1008, "Invalid request");
    return;
  }
  const attachId = requestedAttach(req);
  if (attachId) {
    const existing = sessions.get(attachId);
    if (existing && !existing.closed && existing.term) {
      const live =
        existing.socket &&
        existing.socket !== socket &&
        existing.socket.readyState === existing.socket.OPEN;
      if (live) {
        // Don't silently steal from a second live dashboard window.
        try {
          if (socket.readyState === socket.OPEN) {
            socket.send(
              "\r\n\x1b[31m[session in use by another client — reattach refused]\x1b[0m\r\n",
            );
          }
        } catch {
          /* ignore */
        }
        try {
          socket.close();
        } catch {
          /* ignore */
        }
        log(`attach refused for ${attachId} — live client already connected`);
        return;
      }
      // Stale/half-closed socket — take over cleanly.
      if (existing.socket && existing.socket !== socket) {
        try {
          existing.socket.close();
        } catch {
          /* ignore */
        }
      }
      log(`session reattached (pid: ${existing.term.pid})`);
      bindSocket(existing, socket, { reattached: true, wterm });
      return;
    }
    if (!strictAttach) log(`attach miss for ${attachId} — spawning fresh session`);
  }

  if (strictAttach) {
    sendCtl(socket, { type: "attach-missing" });
    socket.close(4004, "Session not found");
    return;
  }

  const cwd = requestedCwd(req) ?? developerDir();
  const mode = requestedMode(req);
  createSession(cwd, mode, socket, wterm);
});

function shutdown(): void {
  for (const session of sessions.values()) {
    destroySession(session, "shutdown");
  }
  for (const client of wss.clients) {
    try {
      client.close();
    } catch {
      /* ignore */
    }
  }
  try {
    fs.rmSync(SHELL_INTEGRATION_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  wss.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
