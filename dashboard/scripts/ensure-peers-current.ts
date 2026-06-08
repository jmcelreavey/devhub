#!/usr/bin/env tsx
/**
 * Bring the peer services up to date BEFORE Next.js starts compiling.
 *
 * The OpenChamber refresh runs `npm install … --no-package-lock` into
 * dashboard/node_modules, which reconciles the whole tree and briefly
 * moves/removes files. If that runs concurrently with the Next dev/start
 * compile (as it used to, inside start-peer-services.ts) the compiler reads
 * a half-written node_modules and dies with ENOENT / "module not found".
 *
 * Running it here — chained after health-check in `predev`/`prestart`, before
 * the `concurrently` that launches Next + peers — guarantees node_modules is
 * fully settled before the first compile. Peers still tracks upstream on every
 * start; it just no longer mutates node_modules out from under the bundler.
 *
 * Always exits 0: updates are best-effort and must never block the app.
 */
import process from "node:process";
import { loadEnvWithOnePasswordFallback } from "./op-secrets";
import { ensureOpenChamberCurrent } from "../lib/openchamber-update";
import { ensureOpenCodeCurrent } from "../lib/opencode-update";

function log(msg: string): void {
  process.stdout.write(`[peers] ${msg}\n`);
}

async function main(): Promise<void> {
  await loadEnvWithOnePasswordFallback(process.cwd());
  // OpenCode upgrades a standalone binary; OpenChamber rewrites node_modules.
  // Both run serially here so they finish before Next compiles.
  ensureOpenCodeCurrent(log);
  ensureOpenChamberCurrent(process.cwd(), log);
}

main().catch((err) => {
  // Never fatal — keep existing versions and let the app start.
  log(`update check skipped: ${err instanceof Error ? err.message : String(err)}`);
});
