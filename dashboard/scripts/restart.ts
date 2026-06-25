#!/usr/bin/env tsx
/**
 * Rebuild the dashboard and restart the running `next start` instance.
 *
 * Why this exists: `next start` reads the .next/ build at boot. If you run
 * `next build` while a server is already running, the running instance keeps
 * serving the old chunks and any new pages 500. This script makes the
 * rebuild-and-relaunch flow a single command.
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

function lineListeningOnPort(ssStdout: string, portArg: string): string | undefined {
  const portBound = new RegExp(`:${portArg}\\b`);
  return ssStdout.split("\n").find((l) => l.includes("LISTEN") && portBound.test(l));
}

function log(msg: string): void {
  process.stdout.write(`[restart] ${msg}\n`);
}

function tryPortLookupLinux(portArg: string): string | null {
  const out = spawnSync("ss", ["-tlnp"], { encoding: "utf-8" });
  if (out.status !== 0 || !out.stdout) return null;
  return lineListeningOnPort(out.stdout, portArg) ?? null;
}

function tryPortLookupMac(portArg: string): string | null {
  const out = spawnSync("lsof", ["-nP", `-tiTCP:${portArg}`, "-sTCP:LISTEN"], { encoding: "utf-8" });
  if (out.status !== 0 || !out.stdout?.trim()) return null;
  return out.stdout.trim();
}

function findExistingServer(): number | null {
  const line = tryPortLookupLinux(port) ?? tryPortLookupMac(port);
  if (!line) return null;
  if (process.platform === "darwin") {
    const pid = line.trim().split("\n")[0]?.trim();
    return pid ? Number.parseInt(pid, 10) : null;
  }
  const match = line.match(/pid=(\d+)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function portListening(line: string | null): boolean {
  return line !== null;
}

function checkPortListening(portArg: string): boolean {
  return portListening(tryPortLookupLinux(portArg) ?? tryPortLookupMac(portArg));
}

async function waitForPort(timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (checkPortListening(port)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function main(): Promise<void> {
  log("running next build…");
  const build = spawnSync("npx", ["next", "build"], {
    cwd: dashboardRoot,
    stdio: "inherit",
  });
  if (build.status !== 0) {
    log("build failed — leaving running server alone");
    process.exit(build.status ?? 1);
  }

  const existing = findExistingServer();
  if (existing) {
    log(`stopping existing server (pid ${existing})…`);
    try {
      process.kill(existing, "SIGTERM");
      await new Promise((r) => setTimeout(r, 1500));
      try {
        process.kill(existing, 0);
        process.kill(existing, "SIGKILL");
      } catch {
        // already gone
      }
    } catch {
      log(`could not stop pid ${existing} — continuing anyway`);
    }
  }

  log(`starting next on http://${host}:${port}…`);
  const child = spawn("npx", ["next", "start", "-p", port, "-H", host], {
    cwd: dashboardRoot,
    stdio: "ignore",
    detached: true,
    env: process.env,
  });
  child.unref();

  const ok = await waitForPort(15_000);
  if (!ok) {
    log(`server did not bind to ${host}:${port} within 15s — check logs`);
    process.exit(1);
  }
  log(`up at http://${host}:${port} (pid ${child.pid})`);
}

main().catch((err) => {
  log(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
