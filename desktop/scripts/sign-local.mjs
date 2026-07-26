#!/usr/bin/env node
/**
 * Ad-hoc sign a locally built `DevHub.app`.
 *
 * This is **not** a substitute for Developer ID signing. An ad-hoc signature
 * has no identity behind it: macOS can verify the bundle has not been modified
 * since signing, but not who produced it. Gatekeeper still refuses to launch it
 * by double-click on a machine that did not build it, and notarisation is not
 * possible at all. Real distribution needs an Apple Developer ID — see
 * `docs/guides/desktop-release.md`.
 *
 * What it *does* buy, on the machine that built it:
 *
 * - `codesign --verify --deep --strict` passes, so the release pipeline's own
 *   verification step is exercised locally instead of only ever in CI.
 * - The bundle gets a stable identity for the keychain and for macOS's local
 *   network / automation permission prompts, which are otherwise re-asked on
 *   every rebuild because an unsigned app has no stable identity to remember.
 * - Tampering with the nested Node runtime is detected.
 *
 * Signing order is inside-out and that is load-bearing. Signing the bundle
 * first and the nested binaries afterwards invalidates the outer signature,
 * which is the single most common way "I signed it" produces a bundle that
 * fails verification.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { tauriDir } from "./staging-paths.mjs";

if (process.platform !== "darwin") {
  process.stdout.write("[sign] not macOS — nothing to do\n");
  process.exit(0);
}

const targetArg = process.argv.indexOf("--target");
const target = targetArg !== -1 ? process.argv[targetArg + 1] : null;

function findApp() {
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
if (!app) {
  process.stderr.write("[sign] no DevHub.app found — run npm run desktop:build first\n");
  process.exit(1);
}

function log(msg) {
  process.stdout.write(`[sign] ${msg}\n`);
}

function sign(target) {
  execFileSync(
    "codesign",
    ["--force", "--sign", "-", "--timestamp=none", target],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
}

/**
 * Every Mach-O the bundle carries, deepest first.
 *
 * `.node` files are native addons — Mach-O dylibs that macOS treats as code.
 * An unsigned one inside a signed bundle is exactly the mismatch that makes
 * `--strict` fail, and it is easy to miss because nothing about the filename
 * says "executable".
 */
function nestedBinaries() {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.isSymbolicLink()) continue;
      if (entry.name.endsWith(".node") || entry.name.endsWith(".dylib")) {
        found.push(full);
        continue;
      }
      // Extensionless files with the executable bit are the bundled runtime.
      const stat = fs.statSync(full);
      if (!path.extname(entry.name) && stat.mode & 0o111) found.push(full);
    }
  };
  walk(path.join(app, "Contents"));
  // Deepest first: a parent signed before its children is a parent whose
  // signature the children then invalidate.
  return found.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
}

const binaries = nestedBinaries();
for (const binary of binaries) {
  sign(binary);
}
log(`signed ${binaries.length} nested binaries`);

// The bundle last, so it seals everything above.
sign(app);
log(`signed ${path.relative(process.cwd(), app)}`);

try {
  execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  log("codesign --verify --deep --strict passed");
} catch (err) {
  process.stderr.write(`[sign] verification FAILED:\n${err.stderr?.toString() ?? err.message}\n`);
  process.exit(1);
}

// `spctl` is expected to reject an ad-hoc bundle. Reporting it rather than
// hiding it keeps the limitation visible: this is why other people cannot
// simply double-click your build.
try {
  execFileSync("spctl", ["-a", "-vv", "-t", "exec", app], { stdio: ["ignore", "ignore", "pipe"] });
  log("spctl accepted the bundle (unexpected for an ad-hoc signature)");
} catch {
  log("spctl rejects it, as expected — ad-hoc signatures are not notarised.");
  log("      On this Mac: right-click → Open, once. Other machines need a Developer ID.");
}
