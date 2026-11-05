import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { repoRoot } from "./staging-paths.mjs";

const require = createRequire(import.meta.url);
const { tryAcquireProcessDirectoryLock } = require("tsx/cjs/api").require(
  path.join(repoRoot, "packages/shared/process/directory-lock.ts"), import.meta.url,
);

export function acquireDashboardBuildLock(sourceRoot = repoRoot) {
  const directory = path.join(fs.realpathSync(sourceRoot), ".devhub");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const release = tryAcquireProcessDirectoryLock(path.join(directory, "dashboard-build.lock"));
  if (!release) throw new Error("Another dashboard build is already running for this checkout. Let it finish before rebuilding.");
  return release;
}
