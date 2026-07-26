#!/usr/bin/env node
/** Everything the Tauri bundle needs, in dependency order. */
import { stageDashboard } from "./stage-dashboard.mjs";
import { stageResources } from "./stage-resources.mjs";
import { stageNodeRuntime } from "./stage-node-runtime.mjs";

const noBuild = process.argv.includes("--no-build");

try {
  await stageNodeRuntime();
  stageResources();
  await stageDashboard({ build: !noBuild });
  process.stdout.write("[stage] complete\n");
} catch (err) {
  process.stderr.write(`[stage] ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
