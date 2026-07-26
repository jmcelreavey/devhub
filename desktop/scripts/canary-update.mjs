#!/usr/bin/env node
/**
 * Rehearse a real N→N+1 update, end to end, locally.
 *
 * The updater is the one mechanism here whose failure mode is unrecoverable:
 * if signing, the manifest, or version comparison is wrong, installed clients
 * stop updating and cannot be fixed remotely — every user has to notice and
 * reinstall by hand. "It compiles and the signature file exists" is not
 * evidence that it works.
 *
 * So this builds a second version, points the installed app at a manifest via
 * `DEVHUB_UPDATE_ENDPOINT`, and performs a genuine download → verify → install.
 * The signature is checked by Tauri against the public key compiled into the
 * *installed* binary, so this exercises the real cryptographic path — a wrong
 * key fails here exactly as it would in production.
 *
 * It also records a data fingerprint before and after, because "the update
 * worked" and "the update kept your notes" are different claims.
 *
 * **The endpoint must be HTTPS.** Tauri refuses a plaintext updater endpoint
 * outright, which is the correct default and is worth not working around: an
 * update fetched over HTTP can be swapped in transit, and while the signature
 * check would catch it, relying on one control when two are available is how
 * you end up relying on none. An earlier version of this script served the
 * manifest from `http://127.0.0.1` and got exactly that refusal.
 *
 * So the rehearsal runs against a real prerelease on GitHub, which has the
 * pleasant side effect of testing the actual publish path too.
 *
 * Usage:
 *   node desktop/scripts/canary-update.mjs 2.0.1 https://.../latest.json
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { desktopDir, repoRoot, tauriDir } from "./staging-paths.mjs";

const nextVersion = process.argv[2];
const endpoint = process.argv[3];
if (!nextVersion || !endpoint) {
  process.stderr.write("usage: canary-update.mjs <next-version> <https-latest-json-url>\n");
  process.exit(1);
}

const INSTALL_PATH = "/Applications/DevHub.app";
const APP_SUPPORT = path.join(os.homedir(), "Library", "Application Support", "DevHub");

let step = 0;
const heading = (t) => process.stdout.write(`\n[${++step}] ${t}\n`);
const ok = (t) => process.stdout.write(`    ok   ${t}\n`);
const info = (t) => process.stdout.write(`         ${t}\n`);
const die = (t) => {
  process.stderr.write(`\n    FAIL ${t}\n\n`);
  process.exit(1);
};

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", ...opts });
}

function plist(app, key) {
  try {
    return run("/usr/libexec/PlistBuddy", [
      "-c",
      `Print :${key}`,
      path.join(app, "Contents", "Info.plist"),
    ]).trim();
  } catch {
    return null;
  }
}

/** Names + sizes + mtimes of the user's content. Cheap, and enough to spot damage. */
function fingerprint(dir) {
  if (!fs.existsSync(dir)) return "absent";
  const entries = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === "node_modules") continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else {
        try {
          const st = fs.statSync(full);
          entries.push(`${path.relative(dir, full)}|${st.size}`);
        } catch {
          /* transient */
        }
      }
    }
  };
  walk(dir);
  entries.sort();
  return `${entries.length}:${crypto.createHash("sha256").update(entries.join("\n")).digest("hex").slice(0, 12)}`;
}

function contentDirs() {
  const dirs = { "app data": APP_SUPPORT };
  const env = path.join(APP_SUPPORT, "config", ".env.local");
  try {
    for (const line of fs.readFileSync(env, "utf8").split(/\r?\n/)) {
      const m = line.match(/^(NOTES_DIR|TASKS_DIR|COLLECTIONS_DIR|UPSTARTS_DIR)=(.+)$/);
      if (m && fs.existsSync(m[2].trim())) dirs[m[1]] = m[2].trim();
    }
  } catch {
    /* no config yet */
  }
  return dirs;
}

// ---------------------------------------------------------------------------

if (process.platform !== "darwin") die("macOS only for now.");
if (!fs.existsSync(INSTALL_PATH)) die("No installed DevHub. Run `npm run desktop:install` first.");

const installedVersion = plist(INSTALL_PATH, "CFBundleShortVersionString");

heading("Starting point");
ok(`installed version ${installedVersion}`);
if (installedVersion === nextVersion) {
  die(`Already on ${nextVersion}. Pick a higher version — Tauri only updates upward.`);
}

const before = {};
for (const [label, dir] of Object.entries(contentDirs())) {
  before[label] = fingerprint(dir);
  info(`${label}: ${before[label]}`);
}

// 1. Build the "next" version.
heading(`Building ${nextVersion}`);
const signingKey = path.join(os.homedir(), ".tauri", "devhub-updater.key");
if (!fs.existsSync(signingKey)) {
  die(`No signing key at ${signingKey}. Without it the update cannot be signed, and an unsigned update is refused by design.`);
}

run(process.execPath, [path.join(desktopDir, "scripts", "inject-version.mjs"), nextVersion], {
  stdio: "inherit",
});

const buildEnv = {
  ...process.env,
  TAURI_SIGNING_PRIVATE_KEY: fs.readFileSync(signingKey, "utf8"),
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
};

try {
  run("cargo", ["tauri", "build", "--config", "src-tauri/tauri.conf.json", "--bundles", "app"], {
    cwd: desktopDir,
    stdio: "inherit",
    env: buildEnv,
  });
} catch {
  die("Build failed.");
} finally {
  // Always restore, even on failure — leaving the repo on a bumped version
  // that was never released is how a later release silently skips a number.
  run(process.execPath, [path.join(desktopDir, "scripts", "inject-version.mjs"), installedVersion], {
    stdio: "inherit",
  });
}

const bundleDir = path.join(tauriDir, "target", "release", "bundle", "macos");
const tarball = path.join(bundleDir, "DevHub.app.tar.gz");
const sigFile = `${tarball}.sig`;
if (!fs.existsSync(tarball) || !fs.existsSync(sigFile)) {
  die("No signed updater artifact was produced. Is bundle.createUpdaterArtifacts still true?");
}
ok(`updater artifact ${(fs.statSync(tarball).size / 1024 / 1024).toFixed(1)} MB, signed`);

// 2. Point at the manifest.
heading("Update source");
if (!endpoint.startsWith("https://")) {
  die(
    "The endpoint must be HTTPS. Tauri refuses a plaintext updater endpoint, and that " +
      "default is worth keeping — publish a prerelease and pass its latest.json URL.",
  );
}
ok(endpoint);
info(`signature: ${fs.readFileSync(sigFile, "utf8").trim().slice(0, 24)}…`);

// 3. Run the update from the installed app, headlessly.
heading("Running the update from the installed app");
spawnSync("pkill", ["-f", "DevHub.app/Contents/MacOS/devhub-desktop"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2000));

/**
 * `--canary-update` uses the same updater builder, the same signature
 * verification and the same install as the banner's Download button, with no
 * window and no sidecar. A pass here is evidence about the real thing, not
 * about a test harness.
 */
const result = spawnSync(
  path.join(INSTALL_PATH, "Contents", "MacOS", "devhub-desktop"),
  ["--canary-update"],
  {
    env: { ...process.env, DEVHUB_UPDATE_ENDPOINT: endpoint },
    encoding: "utf8",
    timeout: 5 * 60 * 1000,
  },
);

for (const line of `${result.stdout ?? ""}${result.stderr ?? ""}`.split("\n")) {
  if (line.trim()) info(line.trim());
}

if (result.status !== 0) {
  die("The update did not complete. See the lines above.");
}

// 4. Prove it, from disk rather than from the app's own report.
heading("Verifying the installed version");
const installedNow = plist(INSTALL_PATH, "CFBundleShortVersionString");
if (installedNow !== nextVersion) {
  die(`Installed version is ${installedNow}, expected ${nextVersion}.`);
}
ok(`${installedVersion} → ${installedNow}`);

// 5. The claim that matters more than "it updated".
heading("Checking your data survived");
let changed = 0;
for (const [label, dir] of Object.entries(contentDirs())) {
  const after = fingerprint(dir);
  if (after !== before[label]) {
    changed += 1;
    process.stderr.write(`    CHANGED ${label}: ${before[label]} → ${after}\n`);
  } else {
    ok(`${label} unchanged`);
  }
}

// 6. Does the updated app still work?
heading("Self-testing the updated app");
const selfTest = spawnSync(
  path.join(INSTALL_PATH, "Contents", "MacOS", "devhub-desktop"),
  ["--self-test"],
  {
    stdio: "inherit",
    timeout: 6 * 60 * 1000,
    env: {
      ...process.env,
      DEVHUB_SELFTEST_RESOURCES: path.join(INSTALL_PATH, "Contents", "Resources"),
      DEVHUB_SELFTEST_NODE: path.join(INSTALL_PATH, "Contents", "MacOS", "node"),
    },
  },
);


if (selfTest.status !== 0) die("The updated app failed its own --self-test.");
if (changed > 0) die(`${changed} content location(s) changed during the update.`);

process.stdout.write(
  `\nCanary passed. ${installedVersion} → ${nextVersion}, signature verified, data intact.\n` +
    `The installed app is now ${nextVersion}; rebuild and reinstall ${installedVersion} if you want to go back.\n`,
);
void repoRoot;
process.exit(0);
