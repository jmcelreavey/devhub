#!/usr/bin/env node
/**
 * Sign a locally built (or locally installed) `DevHub.app`.
 *
 * This is **not** a substitute for Developer ID signing. Gatekeeper still
 * refuses to launch a locally signed build by double-click on a machine that
 * did not produce it, and notarisation is not possible at all. Real
 * distribution needs an Apple Developer ID — see
 * `docs/guides/desktop-release.md`.
 *
 * What it *does* buy on this Mac: `codesign --verify --deep --strict` passes,
 * so the bundle has an intact seal, and macOS has something stable to hang TCC
 * grants (Full Disk Access, Local Network, Automation) on. Run
 * `npm run desktop:sign:identity` first and those grants survive rebuilds; with
 * a bare ad-hoc signature they are forgotten every time the cdhash changes.
 *
 * Usage:
 *   node desktop/scripts/sign-local.mjs                # newest build output
 *   node desktop/scripts/sign-local.mjs --target <t>   # a specific cargo target
 *   node desktop/scripts/sign-local.mjs --app <path>   # e.g. the installed app
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { tauriDir } from "./staging-paths.mjs";
import { signBundle, verifyBundle } from "./codesign-bundle.mjs";

if (process.platform !== "darwin") {
  process.stdout.write("[sign] not macOS — nothing to do\n");
  process.exit(0);
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index !== -1 ? process.argv[index + 1] : null;
}

const target = argValue("--target");

function findApp() {
  const explicit = argValue("--app");
  if (explicit) return path.resolve(explicit);

  const base = path.join(tauriDir, "target");
  const dirs = [];
  if (target) dirs.push(path.join(base, target, "release"), path.join(base, target, "debug"));
  dirs.push(path.join(base, "release"), path.join(base, "debug"));
  for (const dir of dirs) {
    const app = path.join(dir, "bundle", "macos", "DevHub.app");
    if (fs.existsSync(app)) return app;
  }
  return null;
}

const app = findApp();
if (!app || !fs.existsSync(app)) {
  process.stderr.write("[sign] no DevHub.app found — run npm run desktop:build first\n");
  process.exit(1);
}

function log(msg) {
  process.stdout.write(`[sign] ${msg}\n`);
}

const { identity, kind, nested } = signBundle(app);
log(`signed ${nested} nested binaries`);
log(`signed ${path.relative(process.cwd(), app)} with ${kind === "adhoc" ? "an ad-hoc signature" : identity}`);
if (kind === "adhoc") {
  log("no stable identity: macOS will re-ask for permissions after every rebuild.");
  log("      Fix once with: npm run desktop:sign:identity");
}

const verified = verifyBundle(app);
if (!verified.ok) {
  process.stderr.write(`[sign] verification FAILED:\n${verified.output}\n`);
  process.exit(1);
}
log("codesign --verify --deep --strict passed");

// `spctl` is expected to reject a locally signed bundle. Reporting it rather
// than hiding it keeps the limitation visible: this is why other people cannot
// simply double-click your build.
try {
  execFileSync("spctl", ["-a", "-vv", "-t", "exec", app], { stdio: ["ignore", "ignore", "pipe"] });
  log("spctl accepted the bundle (unexpected without a Developer ID)");
} catch {
  log("spctl rejects it, as expected — local signatures are not notarised.");
  log("      On this Mac: right-click → Open, once. Other machines need a Developer ID.");
}
