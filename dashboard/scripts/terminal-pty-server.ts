#!/usr/bin/env tsx
/**
 * Terminal peer — a WebSocket-fronted PTY on TERMINAL_PORT (default 1339).
 *
 * Each browser connection spawns a shell rooted at the developer directory
 * (~/Developer) and relays bytes both ways. The xterm.js client
 * (components/TerminalDock.tsx) connects over ws://localhost:1339.
 *
 * Shell modes (client picks via `?shell=` on the WS URL):
 * - `login` — $SHELL -l, full rc files. The real environment.
 * - `safe`  — rc files skipped (zsh -f / bash --norc). For frameworks like
 *   powerlevel10k/ftazsh whose interactive init deadlocks in an embedded PTY.
 * - `bash`  — plain /bin/bash --norc -i.
 *
 * Hang watchdog: if a login shell produces zero output within HANG_MS the
 * server kills it, tells the client (control frame), and respawns in safe
 * mode automatically — nobody stares at a dead prompt.
 *
 * SECURITY NOTE: binds to localhost and runs an unauthenticated shell. That
 * is acceptable ONLY because DevHub runs exclusively on the user's own
 * machine, never hosted. Do not expose this port off-host.
 */
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { WebSocketServer, type WebSocket, type RawData } from "ws";
import type { IncomingMessage } from "node:http";
import * as pty from "node-pty";

const PORT = Number.parseInt(process.env.TERMINAL_PORT ?? "1339", 10);
/** A shell that prints nothing for this long during startup is presumed hung. */
const HANG_MS = 4_000;

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
 * noise this server was launched with so subshells start from a normal slate.
 */
function shellEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key.startsWith("npm_") || key.startsWith("NEXT_") || key === "NODE_OPTIONS") continue;
    env[key] = value;
  }
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

const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });

wss.on("listening", () => {
  log(`PTY server listening on ws://127.0.0.1:${PORT} (cwd: ${developerDir()})`);
});

wss.on("error", (err: unknown) => {
  log(`server error: ${err instanceof Error ? err.message : String(err)}`);
});

wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
  const cwd = requestedCwd(req) ?? developerDir();
  let term: pty.IPty | null = null;
  let cols = 80;
  let rows = 24;
  let hangTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const clearHangTimer = () => {
    if (hangTimer) {
      clearTimeout(hangTimer);
      hangTimer = null;
    }
  };

  const spawnShell = (mode: ShellMode, { watchdog }: { watchdog: boolean }) => {
    const { cmd, args } = shellCommand(mode);
    let sawOutput = false;

    const t = pty.spawn(cmd, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: shellEnv(),
    });
    term = t;
    log(`session started (mode: ${mode}, shell: ${cmd} ${args.join(" ")}, pid: ${t.pid})`);
    sendCtl(socket, { type: "session", mode, shell: `${cmd} ${args.join(" ")}`.trim(), cwd });

    t.onData((data) => {
      if (!sawOutput) {
        sawOutput = true;
        clearHangTimer();
      }
      if (socket.readyState === socket.OPEN) socket.send(data);
    });

    t.onExit(({ exitCode }) => {
      if (closed || term !== t) return;
      if (socket.readyState === socket.OPEN) {
        socket.send(`\r\n\x1b[90m[process exited — code ${exitCode}]\x1b[0m\r\n`);
        sendCtl(socket, { type: "exited", exitCode });
      }
    });

    if (watchdog) {
      clearHangTimer();
      hangTimer = setTimeout(() => {
        if (closed || sawOutput || term !== t) return;
        log(`watchdog: ${cmd} produced no output in ${HANG_MS}ms — falling back to safe mode`);
        sendCtl(socket, { type: "fallback", from: mode, to: "safe" });
        try {
          t.kill();
        } catch {
          /* already gone */
        }
        spawnShell("safe", { watchdog: false });
      }, HANG_MS);
    }
  };

  // Only the full login shell can hang on rc files — watchdog it alone.
  const mode = requestedMode(req);
  spawnShell(mode, { watchdog: mode === "login" });

  socket.on("message", (raw: RawData) => {
    const text = raw.toString();
    // Try to parse a control frame; fall back to treating it as stdin.
    if (text.startsWith("{")) {
      try {
        const parsed = JSON.parse(text);
        if (isResize(parsed)) {
          cols = Math.max(1, parsed.cols);
          rows = Math.max(1, parsed.rows);
          term?.resize(cols, rows);
          return;
        }
      } catch {
        /* not JSON — fall through to raw input */
      }
    }
    term?.write(text);
  });

  socket.on("close", () => {
    closed = true;
    clearHangTimer();
    if (term) log(`session ended (pid: ${term.pid})`);
    try {
      term?.kill();
    } catch {
      /* already gone */
    }
  });
});

function shutdown(): void {
  for (const client of wss.clients) {
    try {
      client.close();
    } catch {
      /* ignore */
    }
  }
  wss.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
