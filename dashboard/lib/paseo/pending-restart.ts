import fs from "node:fs";
import path from "node:path";
import { execExternal } from "@/lib/exec-external";
import { getAppDataDir } from "@/lib/desktop/runtime-paths";
import { paseoWebOrigin } from "./client";
import { PASEO_SYSTEMD_UNIT } from "./managed";
import { hasActivePaseoWork } from "./update";

/**
 * The desktop shell rewrites `devhub-paseo.service` on update (durable node, no
 * npm prefix, cleaned PATH) but never restarts the daemon itself: it can't see
 * whether a chat is running. It leaves this marker, and the dashboard applies
 * the unit once Paseo is idle, or asks the user to restart it.
 */
export function pendingRestartMarker(appDataDir: string = getAppDataDir()): string {
  return path.join(appDataDir, "paseo", "restart-pending");
}

export function paseoRestartPending(appDataDir?: string): boolean {
  return fs.existsSync(pendingRestartMarker(appDataDir));
}

export function clearPaseoRestartPending(appDataDir?: string): void {
  fs.rmSync(pendingRestartMarker(appDataDir), { force: true });
}

export async function paseoHealthy(): Promise<boolean> {
  try { return (await fetch(`${paseoWebOrigin()}/api/health`, { cache: "no-store", signal: AbortSignal.timeout(3_000) })).ok; } catch { return false; }
}

export type PendingRestartOutcome = "none" | "waiting-for-daemon" | "restarted" | "deferred";

export interface PendingRestartDeps {
  pending: () => boolean;
  running: () => Promise<boolean>;
  hasActiveWork: () => Promise<boolean>;
  tryRestart: () => Promise<void>;
  clear: () => void;
}

/**
 * Apply a rewritten unit. `deferred` leaves the marker so Agents → Connection
 * can offer "Restart Paseo to apply the update"; that includes the case where
 * activity can't be verified, because an unchecked restart could kill a chat.
 */
export async function applyPendingPaseoRestart(deps: PendingRestartDeps): Promise<PendingRestartOutcome> {
  if (!deps.pending()) return "none";
  if (!await deps.running()) return "waiting-for-daemon";
  if (await deps.hasActiveWork().catch(() => true)) return "deferred";
  try {
    await deps.tryRestart();
  } catch {
    return "deferred";
  }
  deps.clear();
  return "restarted";
}

export function applyPendingPaseoRestartNow(): Promise<PendingRestartOutcome> {
  return applyPendingPaseoRestart({
    pending: () => paseoRestartPending(),
    running: paseoHealthy,
    hasActiveWork: hasActivePaseoWork,
    // try-restart leaves a stopped service stopped; the new unit applies when it starts.
    tryRestart: async () => { await execExternal("/usr/bin/systemctl", ["--user", "try-restart", PASEO_SYSTEMD_UNIT], { timeoutMs: 60_000, label: "paseo:try-restart" }); },
    clear: () => clearPaseoRestartPending(),
  });
}

/** At dashboard start. systemd may still be bringing the daemon up, so wait a little. */
export function startPendingPaseoRestart(attempts = 6, delayMs = 5_000): void {
  if (process.platform !== "linux") return;
  void (async () => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const outcome = await applyPendingPaseoRestartNow().catch(() => "deferred" as const);
      if (outcome !== "waiting-for-daemon") return;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    // Never came up: it will start on the new unit anyway.
    clearPaseoRestartPending();
  })().catch((error: unknown) => console.error("[paseo] could not apply the updated service:", error));
}
