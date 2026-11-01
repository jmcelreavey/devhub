export const syncLocalOps: {
  runSync: typeof import("node:child_process").execFileSync;
  spawnSync: typeof import("node:child_process").spawnSync;
};
