import { execFileSync, spawnSync } from "node:child_process";

// Standalone Node scripts and synchronous test fixtures cannot import the
// TypeScript adapter or await a process. Keep their calls in the same seam.
export const syncLocalOps = {
  runSync: (...args) => execFileSync(...args),
  spawnSync: (...args) => spawnSync(...args),
};
