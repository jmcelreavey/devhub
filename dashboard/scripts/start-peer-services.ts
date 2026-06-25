#!/usr/bin/env tsx
/**
 * Chain peer services in order: OpenCode (1338) → OpenChamber (1336).
 * Next.js runs separately on PORT (default 1337) via concurrently.
 *
 * Update checks live in scripts/ensure-peers-current.ts, which runs serially
 * in `predev`/`prestart` BEFORE this concurrently step. That keeps the
 * OpenChamber `npm install` (which rewrites node_modules) from racing the
 * Next compile. This script only launches the already-current services.
 */
import process from "node:process";
import { loadEnvWithOnePasswordFallback } from "./op-secrets";
import {
  attachChamberShutdown,
  attachOpenCodeShutdown,
  keepPeerProcessAlive,
  startChamberPeer,
  startOpenCodePeer,
  waitForOpenCodePeer,
} from "../lib/dev-peer-services";
import { isOpenChamberConfigured } from "../lib/peer-service-availability";

function log(msg: string): void {
  process.stdout.write(`[peers] ${msg}\n`);
}

async function main(): Promise<void> {
  await loadEnvWithOnePasswordFallback(process.cwd());

  log("starting OpenCode on OPENCODE_PORT (default 1338)…");
  let opencode;
  try {
    opencode = await startOpenCodePeer(log);
  } catch (err) {
    log(`warning: ${err instanceof Error ? err.message : String(err)} — continuing without OpenCode`);
    opencode = { child: null, reusedExisting: false };
  }

  if (!(await waitForOpenCodePeer(log))) {
    log("warning: OpenCode not reachable — OpenChamber may be degraded");
  }

  attachOpenCodeShutdown(opencode.child, log);

  // OpenChamber is developer-managed: only start it when a system install is
  // present. When it's absent the Chamber nav/iframe is hidden, so there's
  // nothing to serve.
  if (isOpenChamberConfigured()) {
    log("starting OpenChamber on OPENCHAMBER_PORT (default 1336)…");
    try {
      await startChamberPeer(log);
      attachChamberShutdown(log);
    } catch (err) {
      log(`warning: ${err instanceof Error ? err.message : String(err)} — continuing without OpenChamber`);
    }
  } else {
    log("OpenChamber not installed — skipping (install it to enable the Chamber tab)");
  }

  log("peer services ready");
  await keepPeerProcessAlive();
}

main().catch((err) => {
  log(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
