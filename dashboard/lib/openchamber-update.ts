import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { cleanOpenChamberEnv } from "./openchamber-command";

const PKG = "@openchamber/web";

type Log = (msg: string) => void;

/** Version of the pinned copy under dashboard/node_modules, or null if not installed. */
function localInstalledVersion(dashboardDir: string): string | null {
  const pkgJson = path.join(dashboardDir, "node_modules", "@openchamber", "web", "package.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(pkgJson, "utf8")) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

/** Newest published version from the registry, or null if the check fails (e.g. offline). */
function latestPublishedVersion(env: NodeJS.ProcessEnv): string | null {
  const res = spawnSync("npm", ["view", PKG, "version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env,
    timeout: 10_000,
  });
  if (res.status !== 0) return null;
  const version = res.stdout.trim();
  return version || null;
}

/**
 * Best-effort refresh of the pinned OpenChamber copy to the newest published version.
 *
 * Runs on every DevHub start (dev + prod) so the embedded chamber tracks upstream the
 * way the desktop app and OpenCode binary do. Writes only into node_modules
 * (--no-save --no-package-lock) so package.json/lockfile stay clean — a later `npm ci`
 * resets to the pin and the next start re-applies the update. Never fatal: on any
 * failure (offline, registry down, install error) we keep the existing copy and continue.
 */
export function ensureOpenChamberCurrent(dashboardDir: string, log: Log): void {
  if (process.env.DEVHUB_SKIP_CHAMBER_UPDATE) {
    log("OpenChamber auto-update skipped (DEVHUB_SKIP_CHAMBER_UPDATE)");
    return;
  }

  const env = cleanOpenChamberEnv();
  const installed = localInstalledVersion(dashboardDir);
  const latest = latestPublishedVersion(env);

  if (!latest) {
    log(`OpenChamber update check skipped (registry unreachable); using ${installed ?? "existing"}`);
    return;
  }
  if (installed === latest) {
    log(`OpenChamber up to date (${installed})`);
    return;
  }

  log(`OpenChamber ${installed ?? "missing"} → ${latest}; updating pinned copy…`);
  const res = spawnSync(
    "npm",
    [
      "install",
      `${PKG}@${latest}`,
      "--no-save",
      "--no-package-lock",
      "--no-audit",
      "--no-fund",
      "--loglevel",
      "error",
    ],
    { cwd: dashboardDir, stdio: "inherit", env, timeout: 120_000 },
  );

  if (res.status === 0) {
    log(`OpenChamber updated to ${latest}`);
  } else {
    log(`OpenChamber update failed (exit ${res.status ?? "signal"}); keeping ${installed ?? "existing"}`);
  }
}
