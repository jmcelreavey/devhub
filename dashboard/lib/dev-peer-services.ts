import { spawn } from "node:child_process";
import fs from "node:fs";
import {
  chamberProcessPinsExternalOpenCode,
  cleanOpenChamberEnv,
  findOpenChamberBin,
  findOpenChamberServerEntry,
  openChamberInstallVersion,
  resolveOpenChamberBind,
  resolveOpenChamberCommand,
  resolveOpenChamberPort,
  shouldReplaceOpenChamberListener,
} from "./openchamber-command";
import { freePinnedOpenCodePorts } from "./opencode/listen";
import {
  canBindPort,
  canConnect,
  commandAndEnvForPid,
  commandForPid,
  killPidsListeningOnPort,
  pidsListeningOnPort,
  processElapsedSeconds,
  waitForPortListening,
} from "./port-probe";

export type PeerLog = (msg: string) => void;

export interface ChamberPeerHandle {
  reusedExisting: boolean;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPortFree(port: number, host: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!(await canConnect(port, host))) return true;
    await sleep(100);
  }
  return !(await canConnect(port, host));
}

async function ensurePortFree(port: number, host: string, log: PeerLog): Promise<void> {
  killPidsListeningOnPort(port, "SIGTERM");
  if (await waitForPortFree(port, host, 2_000)) return;
  log(`listener on ${port} ignored SIGTERM — sending SIGKILL`);
  killPidsListeningOnPort(port, "SIGKILL");
  await waitForPortFree(port, host, 2_000);
}

function chamberListenerPinnedToExternalOpenCode(port: number): boolean {
  return pidsListeningOnPort(port).some((pid) =>
    chamberProcessPinsExternalOpenCode(commandAndEnvForPid(pid)),
  );
}

function chamberListenerIsStale(port: number, bin: string): boolean {
  const entry = findOpenChamberServerEntry(bin);
  const currentVersion = openChamberInstallVersion(bin);
  let entryMtimeMs: number | undefined;
  if (entry) {
    try {
      entryMtimeMs = fs.statSync(entry).mtimeMs;
    } catch {
      entryMtimeMs = undefined;
    }
  }

  const pids = pidsListeningOnPort(port);
  if (pids.length === 0) return false;
  return pids.some((pid) => {
    const cmdline = commandForPid(pid);
    if (!cmdline) return false;
    return shouldReplaceOpenChamberListener({
      cmdline,
      currentBin: bin,
      currentEntry: entry,
      currentVersion,
      entryMtimeMs,
      processAgeSeconds: processElapsedSeconds(pid),
    });
  });
}

/**
 * Decide what to do about a live listener on `port`: reuse it, or stop it so a
 * fresh daemon can bind. Returns true when the existing one is good enough.
 */
async function canReuseChamberListener(port: number, bin: string | null, log: PeerLog): Promise<boolean> {
  if (chamberListenerPinnedToExternalOpenCode(port)) {
    log(`replacing OpenChamber on port ${port} (pinned to an external OpenCode)`);
  } else if (!bin || !chamberListenerIsStale(port, bin)) {
    log(`OpenChamber already listening on port ${port}`);
    return true;
  } else {
    log(`replacing stale OpenChamber on port ${port} with ${openChamberInstallVersion(bin) ?? bin}`);
  }
  await stopChamberPeer(log, port);
  return false;
}

function runOpenChamberCli(args: string[], log: PeerLog): Promise<void> {
  const cmd = findOpenChamberBin() ?? "openchamber";
  log(`using CLI: ${cmd} ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", env: cleanOpenChamberEnv() });
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

export async function stopChamberPeer(log: PeerLog, port = resolveOpenChamberPort()): Promise<void> {
  try {
    await runOpenChamberCli(["stop", "--port", String(port), "--quiet"], log);
  } catch {
    // CLI stop is best-effort; the bun-bypass daemon often ignores it.
  }
  const { probe } = resolveOpenChamberBind();
  if (await canConnect(port, probe)) {
    await ensurePortFree(port, probe, log);
  }
}

export async function startChamberPeer(log: PeerLog): Promise<ChamberPeerHandle> {
  const port = resolveOpenChamberPort();
  const { host, probe, note } = resolveOpenChamberBind();
  if (note) log(note);

  const bin = findOpenChamberBin();
  if ((await canConnect(port, probe)) && (await canReuseChamberListener(port, bin, log))) {
    return { reusedExisting: true };
  }

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if ((await canConnect(port, probe)) && (await canReuseChamberListener(port, bin, log))) {
      return { reusedExisting: true };
    }

    if (!(await canBindPort(port, host))) {
      log(`port ${port} busy but not accepting connections — retrying (${attempt}/${maxAttempts})`);
      await sleep(1000);
      continue;
    }

    const resolved = resolveOpenChamberCommand();

    if (resolved.bypassesServe) {
      /*
       * We are the daemon's parent now, so this process stays alive rather
       * than forking and exiting. Waiting for it to exit — which is what the
       * `serve` path does below — would hang forever.
       *
       * Readiness comes from the port, not from the process, which is a
       * stronger signal anyway: `serve` returns 0 even when the daemon it
       * forked has already crashed.
       */
      log(`using ${resolved.source}: ${resolved.cmd} ${resolved.argsPrefix.join(" ")}`);
      const child = spawn(
        resolved.cmd,
        [...resolved.argsPrefix, "--port", String(port), "--host", host],
        { stdio: "inherit", env: cleanOpenChamberEnv() },
      );
      child.on("error", (err) => log(`OpenChamber daemon failed to spawn: ${err.message}`));

      // Generous: the daemon starts an OpenCode instance of its own before it
      // binds, and 30s was exactly the timeout that made `serve` give up.
      if (await waitForPortListening(port, 60_000, probe)) {
        log(`OpenChamber daemon is running on port ${port}`);
        return { reusedExisting: false };
      }
      log(`OpenChamber daemon did not bind port ${port} within 60s — retrying (${attempt}/${maxAttempts})`);
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      await sleep(1000);
      continue;
    }

    await runOpenChamberCli(["serve", "--port", String(port), "--host", host, "--quiet"], log);

    // Verify the daemon actually came up — the CLI forks and exits 0 even
    // if the forked daemon crashes immediately.
    if (await waitForPortListening(port, 5_000, probe)) {
      log(`OpenChamber daemon is running on port ${port}`);
      return { reusedExisting: false };
    }

    log(`OpenChamber serve returned but port ${port} is not listening — retrying (${attempt}/${maxAttempts})`);
    await sleep(1000);
  }

  if (await canConnect(port, probe)) {
    log(`OpenChamber is reachable on port ${port} after retries`);
    return { reusedExisting: true };
  }

  throw new Error(`OpenChamber did not start on port ${port}`);
}

let chamberStart: Promise<number> | null = null;

/**
 * Single entry point for "make sure Chamber is serving on 1336": the `/chamber`
 * tab, the desktop-app launcher, and Restart all go through here. Concurrent
 * callers share one start so two tabs cannot race two daemons onto the port.
 */
export function ensureChamberListening(log: PeerLog = () => undefined): Promise<number> {
  chamberStart ??= (async () => {
    // A leftover OpenCode on a pinned port is what makes Chamber attach to a
    // server it cannot restart, which breaks Claude/Cursor Setup.
    freePinnedOpenCodePorts(log);
    await startChamberPeer(log);
    return resolveOpenChamberPort();
  })().finally(() => {
    chamberStart = null;
  });
  return chamberStart;
}
