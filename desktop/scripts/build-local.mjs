#!/usr/bin/env node
/**
 * Local release build: stage, bundle, sign — what `npm run desktop:build` runs.
 *
 * On macOS only the `.app` is bundled. `desktop:install` uses nothing else, and
 * the DMG step drives Finder over AppleScript, so it fails outright from any
 * session without a GUI (an agent, SSH). Chained with `&&`, that failure also
 * skipped signing and left an unsigned app behind. Releases build their own
 * artifacts in CI; other platforms keep the configured bundle targets.
 */
import { spawnSync } from "node:child_process";
import { repoRoot } from "./staging-paths.mjs";

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, ["desktop/scripts/stage-all.mjs"]);
run("cargo", [
  "tauri",
  "build",
  "--config",
  "desktop/src-tauri/tauri.conf.json",
  "--config",
  JSON.stringify({ bundle: { createUpdaterArtifacts: false } }),
  ...(process.platform === "darwin" ? ["--bundles", "app"] : []),
]);
run(process.execPath, ["desktop/scripts/sign-local.mjs"]);
