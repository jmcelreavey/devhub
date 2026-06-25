#!/usr/bin/env tsx
/**
 * Bring the peer services up to date BEFORE Next.js starts compiling.
 *
 * Only OpenCode is auto-updated now: it upgrades a standalone binary in place.
 * OpenChamber is managed by the developer (system install), so DevHub no longer
 * updates it — see `lib/openchamber-command.ts`.
 *
 * Always exits 0: updates are best-effort and must never block the app.
 */
import process from "node:process";
import { loadEnvWithOnePasswordFallback } from "./op-secrets";
import { ensureOpenCodeCurrent } from "../lib/opencode-update";

function log(msg: string): void {
  process.stdout.write(`[peers] ${msg}\n`);
}

async function main(): Promise<void> {
  await loadEnvWithOnePasswordFallback(process.cwd());
  ensureOpenCodeCurrent(log);
}

main().catch((err) => {
  // Never fatal — keep existing versions and let the app start.
  log(`update check skipped: ${err instanceof Error ? err.message : String(err)}`);
});
