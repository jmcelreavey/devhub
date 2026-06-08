import { spawnSync } from "node:child_process";
import { getOpenCodeEnv, resolveOpenCodeBinary } from "./opencode-command";

type Log = (msg: string) => void;

/**
 * Best-effort upgrade of the OpenCode binary to the newest release.
 *
 * Mirrors ensureOpenChamberCurrent (see openchamber-update.ts): runs on every DevHub
 * start so a restart tracks upstream. OpenCode ships a self-detecting `opencode upgrade`
 * that no-ops when already current, so we just delegate to it. Never fatal — on any
 * failure (offline, release server down, upgrade error) we keep the existing binary and
 * continue. An already-running server can't be hot-swapped; the new binary takes effect
 * on the next clean start.
 */
export function ensureOpenCodeCurrent(log: Log): void {
  if (process.env.DEVHUB_SKIP_OPENCODE_UPDATE) {
    log("OpenCode auto-update skipped (DEVHUB_SKIP_OPENCODE_UPDATE)");
    return;
  }

  const binary = resolveOpenCodeBinary();
  log("checking OpenCode for updates…");
  const res = spawnSync(binary, ["upgrade"], {
    stdio: "inherit",
    env: getOpenCodeEnv(),
    timeout: 120_000,
  });

  if (res.error) {
    log(`OpenCode update check skipped (${res.error.message}); using existing binary`);
    return;
  }
  if (res.status !== 0) {
    log(`OpenCode upgrade failed (exit ${res.status ?? "signal"}); keeping existing binary`);
  }
}
