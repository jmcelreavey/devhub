#!/usr/bin/env tsx
/**
 * Rebuild the dashboard and restart the running `next start` instance.
 *
 * Why this exists: `next start` reads the .next/ build at boot. If you run
 * `next build` while a server is already running, the running instance keeps
 * serving the old chunks and any new pages 500. This script makes the
 * rebuild-and-relaunch flow a single command.
 *
 * Process discovery: multiple processes can listen on the port at once (the
 * next server on localhost plus the LAN port proxy on the machine's LAN IP).
 * We kill every *next* listener — matched by command line — and leave the LAN
 * proxy alone, then verify the relaunch with a real HTTP probe rather than
 * "some process is on the port" (which used to report success while the OLD
 * server was still the one listening).
 */
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { envTrimOrDefault, loadEnvLocalIntoProcessIfUnset, resolveBindHost } from "./load-env-local-into-process";

const dashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

loadEnvLocalIntoProcessIfUnset(dashboardRoot);

const port = envTrimOrDefault("PORT", "1337");
const host = resolveBindHost(envTrimOrDefault("DEVHUB_BIND_HOST", "0.0.0.0"));

function log(msg: string): void {
  process.stdout.write(`[restart] ${msg}\n`);
}

/** Every pid listening on the port (there can be several: next + LAN proxy). */
function listListenerPids(portArg: string): number[] {
  const pids = new Set<number>();

  // Linux: ss -tlnp lines carry users:(("cmd",pid=N,fd=M),…)
  const ss = spawnSync("ss", ["-tlnp"], { encoding: "utf-8" });
  if (ss.status === 0 && ss.stdout) {
    const portBound = new RegExp(`:${portArg}\\b`);
    for (const line of ss.stdout.split("\n")) {
      if (!line.includes("LISTEN") || !portBound.test(line)) continue;
      for (const m of line.matchAll(/pid=(\d+)/g)) pids.add(Number.parseInt(m[1], 10));
    }
  }

  // macOS (and Linux fallback): lsof prints one pid per line.
  const lsof = spawnSync("lsof", ["-nP", `-tiTCP:${portArg}`, "-sTCP:LISTEN"], { encoding: "utf-8" });
  if (lsof.status === 0 && lsof.stdout?.trim()) {
    for (const line of lsof.stdout.trim().split("\n")) {
      const pid = Number.parseInt(line.trim(), 10);
      if (Number.isFinite(pid)) pids.add(pid);
    }
  }

  return [...pids];
}

function commandFor(pid: number): string {
  const out = spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf-8" });
  return out.status === 0 ? (out.stdout ?? "").trim() : "";
}

/** Is this listener one of ours to restart (next itself, or its launcher)? */
function isNextListener(command: string): boolean {
  return /next-server|next start|run-next-with-env|next\/dist\/bin\/next/.test(command);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopPids(pids: number[]): Promise<void> {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      log(`could not signal pid ${pid} — continuing anyway`);
    }
  }
  // Give them up to 5s to exit cleanly, then force-kill stragglers.
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && pids.some(pidAlive)) {
    await new Promise((r) => setTimeout(r, 200));
  }
  for (const pid of pids.filter(pidAlive)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

/** True once the server actually answers HTTP on localhost (any status). */
async function httpUp(): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2_000) });
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  // `npm run build`, not bare `next build`: the script pins --webpack (the
  // Turbopack CSS-cache issues) and the prebuild hook syncs plugins/skills.
  log("running npm run build…");
  const build = spawnSync("npm", ["run", "build"], {
    cwd: dashboardRoot,
    stdio: "inherit",
  });
  if (build.status !== 0) {
    log("build failed — leaving running server alone");
    process.exit(build.status ?? 1);
  }

  const listeners = listListenerPids(port);
  const nextPids = listeners.filter((pid) => isNextListener(commandFor(pid)));
  const otherPids = listeners.filter((pid) => !nextPids.includes(pid));
  if (otherPids.length) {
    log(`leaving non-next listeners alone (pids ${otherPids.join(", ")} — e.g. the LAN port proxy)`);
  }
  if (nextPids.length) {
    log(`stopping existing next server${nextPids.length > 1 ? "s" : ""} (pid ${nextPids.join(", ")})…`);
    await stopPids(nextPids);
  }

  log(`starting next on http://${host}:${port}…`);
  let childExited: number | null = null;
  const child = spawn("npx", ["next", "start", "-p", port, "-H", host], {
    cwd: dashboardRoot,
    stdio: "ignore",
    detached: true,
    env: process.env,
  });
  child.on("exit", (code) => {
    childExited = code ?? 1;
  });
  child.unref();

  // Probe the server itself — merely seeing "a listener on the port" is not
  // enough (a stale or unrelated process could be holding it).
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (childExited !== null) {
      log(`next exited with code ${childExited} before binding — is something else on ${port}?`);
      process.exit(1);
    }
    if (await httpUp()) {
      log(`up at http://${host}:${port} (pid ${child.pid})`);
      return;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  log(`server did not answer on 127.0.0.1:${port} within 30s — check logs`);
  process.exit(1);
}

main().catch((err) => {
  log(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
