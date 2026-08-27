#!/usr/bin/env tsx
/**
 * Peer boot: free leftover OpenCode on pinned ports (1338/4096), reap
 * orphaned ephemeral `opencode serve` processes, then exit.
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
 * DevHub does not update either binary. They are user-installed tools it
 * happens to call, so keeping them current is the user's business — `opencode
 * upgrade` / `openchamber update` when they want it. Doing it on every start
 * cost ~7s of a ~24s boot to almost always discover nothing had changed, and
 * an auto-`npm install` that rewrote node_modules mid-boot was a hazard the
 * rest of the startup ordering existed to work around.
 */
import process from "node:process";
import { loadEnvWithOnePasswordFallback } from "./op-secrets";
import { freePinnedOpenCodePorts, reapOrphanOpenCodeServers } from "../lib/opencode/listen";
import { evictStaleChamberListener } from "../lib/dev-peer-services";

function log(msg: string): void {
  process.stdout.write(`[peers] ${msg}\n`);
}

async function main(): Promise<void> {
  await loadEnvWithOnePasswordFallback(process.cwd());

  freePinnedOpenCodePorts(log);
  reapOrphanOpenCodeServers(log);
  await evictStaleChamberListener(log);
  log("peer boot done — OpenCode and OpenChamber start when you open those tabs");
}

main().catch((err) => {
  log(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
