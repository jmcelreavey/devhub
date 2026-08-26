import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { getOpenCodeEnv, resolveOpenCodeBinary } from "@/lib/opencode/command";
import { OPENCODE_EXTERNAL_KEYS } from "@/lib/openchamber-command";
import {
  canConnect,
  killPidsListeningOnPort,
  reserveEphemeralPort,
  waitForPortListening,
} from "@/lib/port-probe";

/** Ports Chamber/OpenCode treat as "configured" external servers. Never bind these. */
export const PINNED_OPENCODE_PORTS = [1338, 4096] as const;

const BIND_HOST = "127.0.0.1";
const OWNED_ENV = "DEVHUB_OPENCODE_OWNED";
const PINNED_PORT_SET = new Set<number>(PINNED_OPENCODE_PORTS);
const SPAWN_WAIT_MS = 15_000;

let child: ChildProcess | null = null;
let port: number | null = null;
let starting: Promise<number> | null = null;

/** Exact argv DevHub uses: `opencode serve --port N --hostname 127.0.0.1`. */
const DEVHUB_SERVE_ARGV = /(?:^|\s|\/)opencode serve --port (\d+) --hostname 127\.0\.0\.1(?:\s|$)/;

export function getDevHubOpenCodePort(): number | null {
  return port;
}

export function isDevHubOpenCodeCommand(cmd: string): boolean {
  return DEVHUB_SERVE_ARGV.test(cmd.trim());
}

export function opencodeSpawnEnv(): NodeJS.ProcessEnv {
  const env = getOpenCodeEnv();
  // Same keys Chamber must not inherit: they pin a serve to a port we do not own.
  for (const key of OPENCODE_EXTERNAL_KEYS) delete env[key];
  // Basic auth here makes the iframe 401 — the tab cannot send it, and this
  // instance is loopback-only. Recap/agent callers still send the header; a
  // password-less server ignores it.
  delete env.OPENCODE_SERVER_PASSWORD;
  delete env.OPENCODE_SERVER_USERNAME;
  env[OWNED_ENV] = "1";
  return env;
}

/** Kill leftover DevHub OpenCode on the old pinned port so Chamber.app can own OpenCode. */
export function freePinnedOpenCodePorts(log: (msg: string) => void = () => undefined): number[] {
  const killed: number[] = [];
  for (const pinned of PINNED_OPENCODE_PORTS) {
    const pids = killPidsListeningOnPort(pinned);
    if (pids.length > 0) {
      log(`freed leftover OpenCode on ${pinned} (pids ${pids.join(",")})`);
      killed.push(...pids);
    }
  }
  return killed;
}

interface ServeProcess {
  pid: number;
  ppid: number;
  cmd: string;
  port: number;
}

function listDevHubOpenCodeServes(): ServeProcess[] {
  if (process.platform === "win32") return [];
  const res = spawnSync("ps", ["-ax", "-o", "pid=,ppid=,command="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const found: ServeProcess[] = [];
  for (const line of (res.stdout ?? "").split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) continue;
    const cmd = match[3];
    const argv = cmd.match(DEVHUB_SERVE_ARGV);
    if (!argv) continue;
    const servePort = Number.parseInt(argv[1], 10);
    if (!Number.isFinite(servePort)) continue;
    found.push({
      pid: Number.parseInt(match[1], 10),
      ppid: Number.parseInt(match[2], 10),
      cmd,
      port: servePort,
    });
  }
  return found;
}

/**
 * Kill leaked DevHub `opencode serve` processes.
 *
 * Dashboard restarts drop the in-memory child handle (ppid 1). Webpack HMR
 * drops the handle while next-server is still the parent (`process.pid`).
 * Chamber's OpenCode is neither.
 */
export function reapOrphanOpenCodeServers(
  log: (msg: string) => void = () => undefined,
  keepPort?: number | null,
): number[] {
  const killed: number[] = [];
  for (const proc of listDevHubOpenCodeServes()) {
    if (keepPort != null && proc.port === keepPort) continue;
    if (child?.pid === proc.pid) continue;
    if (PINNED_PORT_SET.has(proc.port)) continue;
    if (proc.ppid !== 1 && proc.ppid !== process.pid) continue;
    try {
      process.kill(proc.pid, "SIGTERM");
      killed.push(proc.pid);
    } catch {
      /* already gone */
    }
  }
  if (killed.length > 0) {
    log(`reaped orphan OpenCode (pids ${killed.join(",")})`);
  }
  return killed;
}

export function stopDevHubOpenCode(): void {
  if (child?.pid) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  child = null;
  port = null;
}

/**
 * Start (or reuse) DevHub's own OpenCode for `/opencode`, recap, and Datadog
 * Investigate. Always an ephemeral loopback port — never 1338/4096, never
 * exported as OPENCODE_PORT into Chamber.
 */
export async function ensureDevHubOpenCode(log: (msg: string) => void = () => undefined): Promise<number> {
  if (port != null && (await canConnect(port, BIND_HOST))) {
    return port;
  }
  // Two tabs hitting /api/opencode/listen at once must not spawn two servers,
  // one of which nobody ever holds a handle to.
  starting ??= startOpenCode(log).finally(() => {
    starting = null;
  });
  return starting;
}

async function startOpenCode(log: (msg: string) => void): Promise<number> {
  stopDevHubOpenCode();
  reapOrphanOpenCodeServers(log);

  const binary = resolveOpenCodeBinary();
  const nextPort = await reserveEphemeralPort(BIND_HOST);
  log(`starting OpenCode on ephemeral port ${nextPort}`);

  const spawned = spawn(binary, ["serve", "--port", String(nextPort), "--hostname", BIND_HOST], {
    stdio: "ignore",
    env: opencodeSpawnEnv(),
  });

  const started = await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    // spawn() itself can hang (lock contention from leaked serves) without
    // ever emitting spawn/error/close — that used to wedge `starting` forever
    // and leave the tab on "Starting OpenCode…".
    const watchdog = setTimeout(() => {
      log(`opencode spawn timed out on port ${nextPort}`);
      finish(false);
    }, SPAWN_WAIT_MS);
    const done = (value: boolean): void => {
      clearTimeout(watchdog);
      finish(value);
    };
    spawned.once("error", (err) => {
      log(`opencode spawn error: ${err.message}`);
      done(false);
    });
    spawned.once("spawn", () => {
      void waitForPortListening(nextPort, SPAWN_WAIT_MS, BIND_HOST).then(done);
    });
    spawned.once("close", () => done(false));
  });

  if (!started && !(await canConnect(nextPort, BIND_HOST))) {
    try {
      spawned.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    throw new Error(`OpenCode did not start on ephemeral port ${nextPort}`);
  }

  child = spawned;
  port = nextPort;
  spawned.once("exit", () => {
    if (port === nextPort) {
      child = null;
      port = null;
    }
  });
  return nextPort;
}
