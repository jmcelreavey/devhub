#!/usr/bin/env tsx
/**
 * Peer boot: free leftover OpenCode on pinned ports (1338/4096), then exit.
 * Next.js runs separately on PORT (default 1337) via concurrently.
 *
 * DevHub does not start always-on OpenCode or OpenChamber. Binding
 * OPENCODE_PORT (1338) made OpenChamber.app attach to that process as an
 * external server it cannot restart — Claude/Cursor Setup then fails.
 * Always-on Chamber on 1336 starts a second OpenCode that races the desktop
 * app on opencode.json. Both UIs lazy-start instead:
 *   /opencode  → ephemeral loopback OpenCode
 *   /chamber   → OpenChamber on 1336 with a clean env (no skip-start / port pin)
 *
 * Update checks live in scripts/ensure-peers-current.ts, which runs serially
 * in `predev`/`prestart` BEFORE this concurrently step. That keeps the
 * OpenChamber `npm install` (which rewrites node_modules) from racing the
 * Next compile. Packaged startup has no npm lifecycle, so this script still
 * runs those checks when DEVHUB_PACKAGED_RUNTIME=1.
 */
import process from "node:process";
import { loadEnvWithOnePasswordFallback } from "./op-secrets";
import { ensureOpenChamberCurrent } from "../lib/openchamber-command";
import { ensureOpenCodeCurrent } from "../lib/opencode/update";
import { freePinnedOpenCodePorts } from "../lib/opencode/listen";

function log(msg: string): void {
  process.stdout.write(`[peers] ${msg}\n`);
}

async function main(): Promise<void> {
  await loadEnvWithOnePasswordFallback(process.cwd());

  // Dev startup runs this in predev. Packaged startup has no npm lifecycle,
  // so perform the same best-effort check here.
  if (process.env.DEVHUB_PACKAGED_RUNTIME === "1") {
    ensureOpenCodeCurrent(log);
    ensureOpenChamberCurrent(log);
  }

  freePinnedOpenCodePorts(log);
  log("peer boot done — OpenCode and OpenChamber start when you open those tabs");
}

main().catch((err) => {
  log(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
