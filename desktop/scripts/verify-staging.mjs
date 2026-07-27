#!/usr/bin/env node
/**
 * The gate between staging and signing.
 *
 * Everything below runs in CI *before* the bundle is signed and published,
 * because the one thing you cannot do to a signed public release is take it
 * back. This repo is the private mirror — notes, tasks, and a personal identity
 * file are committed next to the code — so "did anything personal get into the
 * bundle" is a question with a genuinely bad wrong answer.
 *
 * Three checks:
 *
 * 1. Every staged resource file is listed in the manifest, and the manifest
 *    matches the bytes on disk. A file appearing without a manifest entry is
 *    the exact shape of an accidental leak.
 * 2. No personal-data path made it in.
 * 3. Nothing that looks like a credential made it in.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { repoRoot, resourcesDir, serverDir } from "./staging-paths.mjs";
import { NATIVE_BINARY_PATTERN, isMuslLinked } from "./native-binaries.mjs";

let failures = 0;
function fail(message) {
  failures += 1;
  process.stderr.write(`FAIL  ${message}\n`);
}
function pass(message) {
  process.stdout.write(`ok    ${message}\n`);
}

const manifestPath = path.join(resourcesDir, "MANIFEST.json");
if (!fs.existsSync(manifestPath)) {
  fail("no MANIFEST.json — run desktop:stage before verifying");
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const listed = new Map(manifest.files.map((f) => [f.path, f]));

function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

// 1. Manifest completeness and integrity.
const onDisk = walk(resourcesDir).filter((p) => p !== "MANIFEST.json");
const unlisted = onDisk.filter((p) => !listed.has(p));
if (unlisted.length > 0) {
  fail(`${unlisted.length} staged file(s) are not in the manifest:\n      ${unlisted.slice(0, 20).join("\n      ")}`);
} else {
  pass(`manifest covers all ${onDisk.length} staged resource files`);
}

let drifted = 0;
for (const rel of onDisk) {
  const entry = listed.get(rel);
  if (!entry) continue;
  const digest = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(resourcesDir, rel)))
    .digest("hex");
  if (digest !== entry.sha256) {
    drifted += 1;
    fail(`digest mismatch for ${rel}`);
  }
}
if (drifted === 0) pass("every staged file matches its recorded digest");

// 2. Personal-data paths. These are the exact directories CONTRIBUTING.md
//    names as the personal-data boundary.
const FORBIDDEN_DIRS = ["notes", "tasks", "collections", "upstarts"];
for (const dir of FORBIDDEN_DIRS) {
  const leaked = onDisk.filter((p) => p === dir || p.startsWith(`${dir}/`));
  if (leaked.length > 0) {
    fail(`personal data staged under ${dir}/ (${leaked.length} files) — this must never ship`);
  }
}
if (FORBIDDEN_DIRS.every((d) => !onDisk.some((p) => p.startsWith(`${d}/`)))) {
  pass("no personal-data directories in the bundle");
}

// The packaged identity must be the generic one, not this developer's.
const identity = path.join(resourcesDir, "persona", "identity.txt");
if (fs.existsSync(identity)) {
  const body = fs.readFileSync(identity, "utf8");
  if (body.includes("Make This Yours")) pass("packaged identity is the generic default");
  else fail("persona/identity.txt is not the generic default — a personal identity may have leaked");
}

// 3. Credential-shaped content, in resources and in the server bundle. Env
//    files are the realistic accident: a stray `.env.local` traced into the
//    standalone output ships real tokens.
const CREDENTIAL_FILES = [/(^|\/)\.env(\.|$)/, /\.pem$/i, /\.key$/i, /id_rsa/i];
const serverFiles = fs.existsSync(serverDir) ? walk(serverDir) : [];
const suspects = [...onDisk, ...serverFiles].filter((p) => CREDENTIAL_FILES.some((re) => re.test(p)));
if (suspects.length > 0) {
  fail(`credential-shaped files staged:\n      ${suspects.slice(0, 20).join("\n      ")}`);
} else {
  pass("no credential-shaped files in the bundle");
}

// 4. Prerendered content.
//
// Next statically prerenders routes at build time using the build machine's
// data. On the private mirror that put real note titles into
// `.next/server/app/notes.html`, which then shipped. `stage-dashboard.mjs`
// builds against an empty content tree to prevent it; this proves it worked,
// because the failure is invisible — the bundle looks completely normal and
// only leaks when someone reads the HTML.
const contentNames = [];
/**
 * The distinctive names are the leaf slugs, not the top-level folders.
 * `notes/` contains `garden/`, `reviews/`, `daily/` — generic words that would
 * match ordinary framework output. The thing that actually identifies a leak is
 * `dx-audit-insider-app-2026-07-14`, three levels down. So this recurses.
 */
function collectContentNames(dir, depth = 0) {
  if (depth > 4) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      collectContentNames(path.join(dir, entry.name), depth + 1);
      if (entry.name.length >= 14) contentNames.push(entry.name);
    } else {
      const stem = entry.name.replace(/\.[^.]+$/, "");
      // Long enough to be unmistakably one of this user's files rather than a
      // word that happens to appear in a framework chunk.
      if (stem.length >= 14) contentNames.push(stem);
    }
  }
}
for (const dir of ["notes", "tasks", "collections", "upstarts"]) {
  collectContentNames(path.join(repoRoot, dir));
}

/**
 * Drop names the app itself hardcodes.
 *
 * Some content paths are conventions, not user data — `radar/personal-radar.md`
 * is linked to by `app/radar/client.tsx`, so its name appears in prerendered
 * HTML whether or not the file exists. Flagging it would train everyone to
 * ignore this check, which is worse than not having it.
 */
const sourceTree = path.join(repoRoot, "dashboard");

/**
 * Names that appear in the app's own source, found in a single pass.
 *
 * An earlier version concatenated every source file into one string and used
 * `String.includes`. That is fine until it is not: the dashboard's sources
 * exceed V8's maximum string length, and `Array.join` threw "Invalid string
 * length" — but only in the Linux container, because the macOS run happened to
 * stay just under the limit. A size-dependent failure that appears on one
 * platform is exactly the kind of thing to remove rather than tune.
 */
const hardcodedNames = new Set();
(function scanSource(dir, depth = 0) {
  if (depth > 6 || contentNames.length === 0) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanSource(full, depth + 1);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx|mjs|json)$/.test(entry.name)) continue;
    let body;
    try {
      body = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    for (const name of contentNames) {
      if (!hardcodedNames.has(name) && body.includes(name)) hardcodedNames.add(name);
    }
  }
})(sourceTree);

const userOnlyNames = contentNames.filter((name) => !hardcodedNames.has(name));

if (userOnlyNames.length === 0) {
  pass("no local personal content to check against (public core checkout)");
} else {
  const prerendered = fs.existsSync(path.join(serverDir, ".next", "server"))
    ? walk(path.join(serverDir, ".next", "server")).filter((p) => /\.(html|rsc|json)$/.test(p))
    : [];
  const leaked = new Set();
  for (const rel of prerendered) {
    const body = fs.readFileSync(path.join(serverDir, ".next", "server", rel), "utf8");
    for (const name of userOnlyNames) {
      if (body.includes(name)) leaked.add(`${name} → ${rel}`);
    }
  }
  if (leaked.size > 0) {
    fail(
      `build-machine content is baked into prerendered output:\n      ${[...leaked].slice(0, 10).join("\n      ")}`,
    );
  } else {
    pass(`prerendered output is free of local content (${userOnlyNames.length} names checked)`);
  }
}

/**
 * 4. No native binary for a foreign platform or libc.
 *
 * `stage-dashboard.mjs` strips these; this is the check that they stayed
 * stripped. It is here rather than left to the bundler because the way it
 * surfaces otherwise is a Linux release job dying at packaging with "failed to
 * run linuxdeploy" and no cause — linuxdeploy resolves every ELF in the AppDir,
 * finds a musl-linked `sharp` prebuild, and cannot satisfy
 * `libc.musl-x86_64.so.1` on a glibc system.
 *
 * On macOS the same binaries are only wasted megabytes, so this check runs on
 * every platform to keep the failure honest wherever it is first noticed.
 */
{
  const nodeModules = path.join(serverDir, "node_modules");
  const offenders = [];
  if (fs.existsSync(nodeModules)) {
    for (const rel of walk(nodeModules)) {
      if (!NATIVE_BINARY_PATTERN.test(rel)) continue;
      if (isMuslLinked(fs.readFileSync(path.join(nodeModules, rel)))) offenders.push(`${rel} (musl)`);
    }
  }
  if (offenders.length > 0) {
    fail(
      `${offenders.length} musl-linked native binary/binaries staged — ` +
        `AppImage packaging will fail on them:\n      ${offenders.slice(0, 10).join("\n      ")}`,
    );
  } else {
    pass("no musl-linked native binaries staged");
  }
}

process.stdout.write(
  failures === 0
    ? "\nStaging verified — safe to sign.\n"
    : `\n${failures} check(s) failed. Refusing to sign this bundle.\n`,
);
process.exit(failures === 0 ? 0 : 1);
