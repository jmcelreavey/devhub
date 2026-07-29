#!/usr/bin/env tsx
/**
 * Bring the peer services up to date BEFORE Next.js starts compiling.
 *
 * Both peers are user-managed installs. Updates are best-effort and happen
 * before the peer servers bind their ports.
 *
 * Always exits 0: updates are best-effort and must never block the app.
 */
import process from "node:process";
import { loadEnvWithOnePasswordFallback } from "./op-secrets";
import { ensureOpenChamberCurrent } from "@/lib/openchamber-command";
import { ensureOpenCodeCurrent } from "@/lib/opencode/update";

function log(msg: string): void {
  process.stdout.write(`[peers] ${msg}\n`);
}

async function main(): Promise<void> {
  await loadEnvWithOnePasswordFallback(process.cwd());
  ensureOpenCodeCurrent(log);
  ensureOpenChamberCurrent(log);
}

main().catch((err) => {
  // Never fatal — keep existing versions and let the app start.
  log(`update check skipped: ${err instanceof Error ? err.message : String(err)}`);
});
