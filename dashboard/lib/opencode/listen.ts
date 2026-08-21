import { spawn, type ChildProcess } from "node:child_process";
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

let child: ChildProcess | null = null;
let port: number | null = null;
let starting: Promise<number> | null = null;

export function getDevHubOpenCodePort(): number | null {
  return port;
}

export function opencodeSpawnEnv(): NodeJS.ProcessEnv {
  const env = getOpenCodeEnv();
  // Same keys Chamber must not inherit: they pin a serve to a port we do not own.
  for (const key of OPENCODE_EXTERNAL_KEYS) delete env[key];
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
    spawned.once("error", (err) => {
      log(`opencode spawn error: ${err.message}`);
      finish(false);
    });
    spawned.once("spawn", () => {
      void waitForPortListening(nextPort, 15_000, BIND_HOST).then(finish);
    });
    spawned.once("close", () => finish(false));
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
