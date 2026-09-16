#!/usr/bin/env node
/**
 * Build the root wake helper (desktop/wake-helper) and stage it for the bundle.
 *
 * It ships inside `Contents/Resources/wake-helper/` purely as a payload: the
 * app's "Enable wake" action copies it to /Library/PrivilegedHelperTools and
 * loads the LaunchDaemon plist beside it, after the macOS admin prompt. The
 * installed copy is independent of the bundle, so rebuilding or re-signing
 * DevHub never breaks a helper that is already running.
 *
 * macOS only — the helper is IOKit and launchd.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { desktopDir, wakeHelperStagingDir } from "./staging-paths.mjs";

export function stageWakeHelper() {
  if (process.platform !== "darwin") {
    process.stdout.write("[stage] wake helper: not macOS — skipped\n");
    return;
  }
  const crate = path.join(desktopDir, "wake-helper");
  process.stdout.write("[stage] wake helper: cargo build --release\n");
  execFileSync("cargo", ["build", "--release", "--manifest-path", path.join(crate, "Cargo.toml")], {
    stdio: "inherit",
  });
  const targetDir = process.env.CARGO_TARGET_DIR ? path.resolve(process.env.CARGO_TARGET_DIR) : path.join(crate, "target");
  const built = path.join(targetDir, "release", "devhub-wake-helper");
  if (!fs.existsSync(built)) throw new Error(`wake helper build produced no binary at ${built}`);

  fs.rmSync(wakeHelperStagingDir, { recursive: true, force: true });
  fs.mkdirSync(wakeHelperStagingDir, { recursive: true });
  const binary = path.join(wakeHelperStagingDir, "devhub-wake-helper");
  fs.copyFileSync(built, binary);
  fs.chmodSync(binary, 0o755);
  fs.copyFileSync(
    path.join(crate, "com.devhub.wake-helper.plist"),
    path.join(wakeHelperStagingDir, "com.devhub.wake-helper.plist"),
  );
  process.stdout.write(`[stage] wake helper: staged to ${path.relative(desktopDir, wakeHelperStagingDir)}\n`);
}
