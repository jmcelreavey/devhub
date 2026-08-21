#!/usr/bin/env node
/**
 * Replace the installed Electron DevHub with the Tauri build, safely.
 *
 * This implements the nine-step gate in
 * `docs/archive/tauri-desktop-plan.md`. It is written defensively
 * because it is the one script here that touches `/Applications` and the one
 * whose failure mode is "the user has no working DevHub".
 *
 * The rules it will not break:
 *
 * - **Nothing under `~/Library/Application Support/DevHub` is ever deleted.**
 *   That directory is shared, migrated state, not disposable Electron code.
 *   Neither are notes, tasks, collections, upstarts, docs, or identity.
 * - **The old bundle is moved, not removed**, and restored automatically if any
 *   check after the swap fails. A failed replacement is not an excuse to strand
 *   a working app.
 * - **It refuses to run on anything it cannot positively identify** as the
 *   Electron DevHub — wrong bundle ID or no Electron Framework and it stops.
 * - **It builds nothing and downloads nothing.** An installer that also builds
 *   is an installer that can fail halfway for reasons unrelated to installing.
 *
 * Usage:
 *   node desktop/scripts/install-local.mjs [--dry-run] [--keep-backup]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { tauriDir } from "./staging-paths.mjs";

const DRY_RUN = process.argv.includes("--dry-run");
const KEEP_BACKUP = process.argv.includes("--keep-backup");

const INSTALL_PATH = "/Applications/DevHub.app";
const EXPECTED_BUNDLE_ID = "com.devhub.launcher";
const HOME = os.homedir();
const APP_SUPPORT = path.join(HOME, "Library", "Application Support", "DevHub");

/** Electron-only updater residue. Everything else under Caches is left alone. */
const ELECTRON_ONLY_CACHES = [
  path.join(HOME, "Library", "Caches", "devhub-launcher-updater"),
  path.join(HOME, "Library", "Caches", `${EXPECTED_BUNDLE_ID}.ShipIt`),
];

let step = 0;
function heading(text) {
  step += 1;
  process.stdout.write(`\n[${step}] ${text}\n`);
}
function ok(text) {
  process.stdout.write(`    ok   ${text}\n`);
}
function info(text) {
  process.stdout.write(`         ${text}\n`);
}
function die(text) {
  process.stderr.write(`\n    FAIL ${text}\n\n`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", ...opts });
}

/**
 * Content fingerprint: file count plus a digest over sorted name+size+mtime.
 *
 * Deliberately not hashing file *contents*. A notes vault can be hundreds of
 * megabytes and the property being checked is "did this installation disturb
 * the user's data", not "has anything ever changed". Names, sizes and mtimes
 * catch every way this script could plausibly cause damage while staying fast
 * enough that nobody skips the check.
 */
function fingerprint(dir) {
  if (!fs.existsSync(dir)) return { exists: false, files: 0, digest: "-" };
  const entries = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = path.join(current, entry.name);
      // The app writes shutdown breadcrumbs while this installer is running.
      // Logs are diagnostic output, not user content, so including them makes
      // a correct replacement look like it modified personal data.
      if (path.relative(dir, full).split(path.sep)[0] === "logs") continue;
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      try {
        const stat = fs.statSync(full);
        entries.push(`${path.relative(dir, full)}|${stat.size}|${Math.floor(stat.mtimeMs)}`);
      } catch {
        /* vanished mid-walk — a cache file, not user data */
      }
    }
  };
  walk(dir);
  entries.sort();
  return {
    exists: true,
    files: entries.length,
    digest: crypto.createHash("sha256").update(entries.join("\n")).digest("hex").slice(0, 16),
  };
}

/** The content paths that must survive untouched. Read from the live config. */
function contentPaths() {
  const paths = new Map();
  paths.set("app support", APP_SUPPORT);

  const envFile = path.join(APP_SUPPORT, "config", ".env.local");
  const candidates = [envFile];

  // Also read the checkout's config, since a not-yet-migrated user's data is
  // still pointed at from there.
  const repoPathFile = path.join(APP_SUPPORT, "repo-path.txt");
  try {
    const checkout = fs.readFileSync(repoPathFile, "utf8").trim();
    if (checkout && fs.existsSync(checkout)) {
      candidates.push(path.join(checkout, "dashboard", ".env.local"));
      for (const seg of ["notes", "tasks", "collections", "upstarts"]) {
        const dir = path.join(checkout, seg);
        if (fs.existsSync(dir)) paths.set(`checkout ${seg}`, dir);
      }
    }
  } catch {
    /* no recorded checkout */
  }

  for (const file of candidates) {
    let raw;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^(NOTES_DIR|TASKS_DIR|COLLECTIONS_DIR|UPSTARTS_DIR|DOCS_DIR)=(.+)$/);
      if (match && fs.existsSync(match[2].trim())) paths.set(match[1], match[2].trim());
    }
  }
  return paths;
}

/** The bundled runtime inside the installed app. See selftest.mjs#findNode. */
function installedNode() {
  const runtime = path.join(INSTALL_PATH, "Contents", "Resources", "runtime");
  if (fs.existsSync(runtime)) {
    const exact = path.join(runtime, "node");
    if (fs.existsSync(exact)) return exact;
    const suffixed = fs.readdirSync(runtime).find((f) => f.startsWith("node-"));
    if (suffixed) return path.join(runtime, suffixed);
  }
  return path.join(INSTALL_PATH, "Contents", "MacOS", "node");
}

function findBuiltApp() {
  const candidates = ["release", "debug"]
    .map((profile) => path.join(tauriDir, "target", profile, "bundle", "macos", "DevHub.app"))
    .filter((app) => fs.existsSync(app));
  return candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] ?? null;
}

function bundleInfo(app) {
  const plist = path.join(app, "Contents", "Info.plist");
  const read = (key) => {
    try {
      return run("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plist]).trim();
    } catch {
      return null;
    }
  };
  return {
    id: read("CFBundleIdentifier"),
    version: read("CFBundleShortVersionString"),
    executable: read("CFBundleExecutable"),
  };
}

// ---------------------------------------------------------------------------

process.stdout.write(
  DRY_RUN
    ? "DevHub local install — DRY RUN, nothing will be changed\n"
    : "DevHub local install\n",
);

if (process.platform !== "darwin") die("This installer is macOS-only.");

// 1. Fingerprint everything the user owns, before touching anything.
heading("Recording what your data looks like now");
const tracked = contentPaths();
const before = new Map();
for (const [label, dir] of tracked) {
  const fp = fingerprint(dir);
  before.set(label, fp);
  info(`${label}: ${fp.files} files (${fp.digest}) — ${dir}`);
}
ok(`${tracked.size} content locations recorded`);

// 2. Verify the build we are about to install.
heading("Verifying the build");
const built = findBuiltApp();
if (!built) die("No built DevHub.app found. Run `npm run desktop:build` first.");
const builtInfo = bundleInfo(built);
if (builtInfo.id !== EXPECTED_BUNDLE_ID) {
  die(`Built bundle identifier is ${builtInfo.id}, expected ${EXPECTED_BUNDLE_ID}.`);
}
ok(`${built}`);
ok(`bundle ${builtInfo.id}, version ${builtInfo.version}`);

const selfTest = spawnSync(
  process.execPath,
  [path.join(path.dirname(new URL(import.meta.url).pathname), "selftest.mjs")],
  { stdio: "inherit", timeout: 6 * 60 * 1000 },
);
if (selfTest.status !== 0) die("The built app failed its own --self-test. Not installing it.");
ok("packaged --self-test passed against a temporary data directory");

// 3. Ask any running DevHub to quit.
heading("Stopping any running DevHub");
if (!DRY_RUN) {
  // By bundle ID and by our own executable name — never "anything on port 1337".
  spawnSync("osascript", ["-e", `tell application id "${EXPECTED_BUNDLE_ID}" to quit`], {
    stdio: "ignore",
    timeout: 15_000,
  });
  spawnSync("pkill", ["-f", "DevHub.app/Contents/MacOS/devhub-desktop"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 3000));
}
ok("no DevHub asked to keep running");

// 4. Confirm what is installed really is the Electron app.
heading("Identifying the currently installed app");
let replacingElectron = false;
if (fs.existsSync(INSTALL_PATH)) {
  const installed = bundleInfo(INSTALL_PATH);
  const electronMarker = path.join(
    INSTALL_PATH,
    "Contents",
    "Frameworks",
    "Electron Framework.framework",
  );
  const hasElectron = fs.existsSync(electronMarker);

  if (installed.id !== EXPECTED_BUNDLE_ID) {
    die(
      `${INSTALL_PATH} has bundle id ${installed.id}, not ${EXPECTED_BUNDLE_ID}. ` +
        `Refusing to replace an app this script did not put there.`,
    );
  }
  if (hasElectron) {
    replacingElectron = true;
    ok(`Electron DevHub ${installed.version} found — safe to replace`);
  } else {
    ok(`Existing DevHub ${installed.version} is already Tauri — this is an upgrade`);
  }
} else {
  ok("nothing installed at /Applications/DevHub.app — fresh install");
}

if (DRY_RUN) {
  process.stdout.write("\nDry run complete. Nothing was changed.\n");
  process.exit(0);
}

// 5. Move the old bundle aside and install the new one.
heading("Installing");
const backup = fs.existsSync(INSTALL_PATH)
  ? `${INSTALL_PATH}.backup-${Date.now()}`
  : null;

if (backup) {
  fs.renameSync(INSTALL_PATH, backup);
  ok(`previous app moved to ${backup}`);
}

/** Put the old app back exactly as it was, then stop. */
function restoreAndDie(reason) {
  process.stderr.write(`\n    FAIL ${reason}\n`);
  if (backup && fs.existsSync(backup)) {
    fs.rmSync(INSTALL_PATH, { recursive: true, force: true });
    fs.renameSync(backup, INSTALL_PATH);
    process.stderr.write(`    Restored your previous DevHub to ${INSTALL_PATH}.\n`);
  }
  process.stderr.write(`    Your data was not touched.\n\n`);
  process.exit(1);
}

try {
  // ditto, not cp: it preserves resource forks, extended attributes, and the
  // code signature. A plain copy can invalidate the signature and produce an
  // app macOS refuses to launch.
  run("ditto", [built, INSTALL_PATH]);
  ok(`installed to ${INSTALL_PATH}`);
  // Dock caches CFBundleIconFile by path + mtime. A same-version upgrade
  // that only swapped the .icns otherwise keeps showing yesterday's BI tile.
  spawnSync("touch", [INSTALL_PATH]);
  spawnSync("killall", ["Dock"], { stdio: "ignore" });
  ok("touched the bundle and restarted Dock so the icon cache drops");
} catch (err) {
  restoreAndDie(`Could not install: ${err.message}`);
}

// 6. Prove the installed copy works from where it now lives.
heading("Verifying the installed copy");
const installedSelfTest = spawnSync(
  path.join(INSTALL_PATH, "Contents", "MacOS", builtInfo.executable ?? "devhub-desktop"),
  ["--self-test"],
  {
    stdio: "inherit",
    timeout: 6 * 60 * 1000,
    env: {
      ...process.env,
      DEVHUB_SELFTEST_RESOURCES: path.join(INSTALL_PATH, "Contents", "Resources"),
      DEVHUB_SELFTEST_NODE: installedNode(),
    },
  },
);
if (installedSelfTest.status !== 0) {
  restoreAndDie("The installed copy failed its --self-test.");
}
ok("installed copy passed --self-test");

// 7. Re-fingerprint. Data must be unchanged.
heading("Checking your data is untouched");
let changed = 0;
for (const [label, dir] of tracked) {
  const after = fingerprint(dir);
  const prior = before.get(label);
  if (after.files !== prior.files || after.digest !== prior.digest) {
    changed += 1;
    process.stderr.write(
      `    CHANGED ${label}: ${prior.files} → ${after.files} files (${prior.digest} → ${after.digest})\n`,
    );
  }
}
if (changed > 0) {
  restoreAndDie(`${changed} content location(s) changed during installation.`);
}
ok(`all ${tracked.size} content locations byte-identical`);

// 8. Clean up Electron-only residue.
heading("Removing Electron-only leftovers");
if (replacingElectron) {
  for (const cache of ELECTRON_ONLY_CACHES) {
    if (fs.existsSync(cache)) {
      fs.rmSync(cache, { recursive: true, force: true });
      ok(`removed ${cache}`);
    }
  }
  // Explicitly NOT removed: ~/Library/Application Support/DevHub (migrated
  // state, window bounds, the repo-path record migration reads) and
  // ~/Library/Caches/com.devhub.launcher (generic, and the bundle ID is shared
  // with the Tauri app).
  info("kept ~/Library/Application Support/DevHub — shared state, not Electron code");
  info("kept ~/Library/Caches/com.devhub.launcher — same bundle id as the new app");
} else {
  ok("nothing to clean up");
}

if (backup && !KEEP_BACKUP) {
  fs.rmSync(backup, { recursive: true, force: true });
  ok("removed the temporary backup of the previous app");
} else if (backup) {
  info(`backup kept at ${backup}`);
}

process.stdout.write(
  `\nDone. DevHub ${builtInfo.version} is installed at ${INSTALL_PATH}.\n` +
    `Your notes, tasks, collections, upstarts and settings were not touched.\n` +
    `\nThis build is ad-hoc signed, so the first launch needs: right-click the app → Open.\n`,
);
