#!/usr/bin/env tsx
/**
 * Start the OpenCode web server on port 1338 (OPENCODE_PORT).
 * Prefer `start-peer-services.ts` for dev — it chains OpenCode before OpenChamber.
 */
import process from "node:process";
import { loadEnvWithOnePasswordFallback } from "./op-secrets";
import {
  attachOpenCodeShutdown,
  keepPeerProcessAlive,
  startOpenCodePeer,
} from "../lib/dev-peer-services";

function log(msg: string): void {
  process.stdout.write(`[opencode] ${msg}\n`);
}

async function main(): Promise<void> {
  await loadEnvWithOnePasswordFallback(process.cwd());

  try {
    const handle = await startOpenCodePeer(log);
    attachOpenCodeShutdown(handle.child, log);
    await keepPeerProcessAlive();
  } catch (err) {
    log(`warning: ${err instanceof Error ? err.message : String(err)} — continuing without OpenCode`);
    await keepPeerProcessAlive();
  }
}

main().catch((err) => {
  log(`warning: ${err instanceof Error ? err.message : String(err)} — continuing without OpenCode`);
  void keepPeerProcessAlive();
});
