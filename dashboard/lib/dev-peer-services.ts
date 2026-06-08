import { spawn, type ChildProcess } from "node:child_process";
import process from "node:process";
import { envTrimOrDefault } from "../scripts/load-env-local-into-process";
import { cleanOpenChamberEnv, resolveOpenChamberCommand } from "./openchamber-command";
import {
  getOpenCodeEnv,
  resolveOpenCodeBinary,
  resolveOpenCodeBindHost,
  resolveOpenCodePort,
} from "./opencode-command";
import { canBindPort, canConnect, waitForPortListening } from "./port-probe";

export type PeerLog = (msg: string) => void;

export interface OpenCodePeerHandle {
  child: ChildProcess | null;
  reusedExisting: boolean;
}

export interface ChamberPeerHandle {
  reusedExisting: boolean;
}

function probeHost(bindHost: string): string {
  return bindHost === "0.0.0.0" ? "127.0.0.1" : bindHost;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startOpenCodePeer(log: PeerLog): Promise<OpenCodePeerHandle> {
  const port = resolveOpenCodePort();
  const bindHost = resolveOpenCodeBindHost();
  const host = probeHost(bindHost);

  if (await canConnect(port, host)) {
    log(`OpenCode already listening on port ${port}`);
    return { child: null, reusedExisting: true };
  }

  let binary: string;
  try {
    binary = resolveOpenCodeBinary();
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : String(err));
  }

  const env = getOpenCodeEnv();
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (await canConnect(port, host)) {
      log(`OpenCode became reachable on port ${port} during startup`);
      return { child: null, reusedExisting: true };
    }

    if (!(await canBindPort(port, host))) {
      if (await canConnect(port, host)) {
        log(`OpenCode already listening on port ${port}`);
        return { child: null, reusedExisting: true };
      }
      log(`port ${port} busy but not accepting connections — retrying (${attempt}/${maxAttempts})`);
      await sleep(500);
      continue;
    }

    log(`using: ${binary} serve --port ${port} --hostname ${bindHost}`);
    const child = spawn(binary, ["serve", "--port", String(port), "--hostname", bindHost], {
      stdio: "inherit",
      env,
    });

    const started = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean): void => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      child.once("error", (err) => {
        log(`opencode spawn error: ${err.message}`);
        finish(false);
      });

      child.once("spawn", () => {
        void waitForPortListening(port, 15_000, host).then(finish);
      });

      child.once("close", (code) => {
        if (code !== 0 && code !== null) {
          log(`opencode serve exited with code ${code}`);
        }
        finish(false);
      });
    });

    if (started || (await canConnect(port, host))) {
      return { child, reusedExisting: false };
    }

    child.kill("SIGTERM");
    log(`OpenCode did not become reachable on port ${port} — retrying (${attempt}/${maxAttempts})`);
    await sleep(500);
  }

  if (await canConnect(port, host)) {
    log(`OpenCode is reachable on port ${port} after retries`);
    return { child: null, reusedExisting: true };
  }

  throw new Error(`OpenCode did not start on port ${port} — check ~/.local/share/opencode/log/`);
}

export async function waitForOpenCodePeer(log: PeerLog, timeoutMs = 30_000): Promise<boolean> {
  const port = resolveOpenCodePort();
  const host = probeHost(resolveOpenCodeBindHost());
  const ready = await waitForPortListening(port, timeoutMs, host);
  if (ready) {
    log(`OpenCode is listening on port ${port}`);
  }
  return ready;
}

function runOpenChamber(args: string[], log: PeerLog): Promise<void> {
  const { cmd, argsPrefix, source } = resolveOpenChamberCommand();
  log(`using ${source}: ${cmd} ${[...argsPrefix, ...args].join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...argsPrefix, ...args], { stdio: "inherit", env: cleanOpenChamberEnv() });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`openchamber ${args.join(" ")} exited with code ${code}`));
    });
  });
}

export async function stopChamberPeer(log: PeerLog, port = Number.parseInt(process.env.OPENCHAMBER_PORT ?? "1336", 10)): Promise<void> {
  try {
    await runOpenChamber(["stop", "--port", String(port), "--quiet"], log);
  } catch {
    // already stopped
  }
}

export async function startChamberPeer(log: PeerLog): Promise<ChamberPeerHandle> {
  const port = Number.parseInt(process.env.OPENCHAMBER_PORT ?? "1336", 10);
  const host = envTrimOrDefault("OPENCHAMBER_HOST", "0.0.0.0");
  const probe = host === "0.0.0.0" ? "127.0.0.1" : host;

  if (await canConnect(port, probe)) {
    log(`OpenChamber already listening on port ${port}`);
    return { reusedExisting: true };
  }

  if (await canBindPort(port, host)) {
    await runOpenChamber(["serve", "--port", String(port), "--host", host, "--quiet"], log);
    log(`OpenChamber daemon is running on port ${port}`);
    return { reusedExisting: false };
  }

  if (await canConnect(port, probe)) {
    log(`OpenChamber already listening on port ${port}`);
    return { reusedExisting: true };
  }

  throw new Error(`OpenChamber port ${port} is busy but not accepting connections`);
}

export function attachOpenCodeShutdown(child: ChildProcess | null, log: PeerLog): () => void {
  let exiting = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (exiting || !child?.pid) return;
    exiting = true;
    log(`shutting down OpenCode (${signal})`);
    child.kill(signal);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  return () => {
    exiting = true;
  };
}

export function attachChamberShutdown(log: PeerLog): () => void {
  const port = Number.parseInt(process.env.OPENCHAMBER_PORT ?? "1336", 10);
  let shuttingDown = false;

  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("shutting down OpenChamber daemon");
    void stopChamberPeer(log, port).finally(() => process.exit(0));
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return () => {
    shuttingDown = true;
  };
}

export function keepPeerProcessAlive(): Promise<never> {
  return new Promise(() => {
    const timer = setInterval(() => undefined, 60_000);
    timer.ref();
  });
}
