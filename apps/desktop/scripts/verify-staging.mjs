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
import { dashboardDir, resourcesDir, serverDir, stagingDir } from "./staging-paths.mjs";
import { GENERIC_WRITING_STYLE, isPersonalSourcePath } from "./stage-resources.mjs";
import { NATIVE_BINARY_PATTERN, isMuslLinked } from "./native-binaries.mjs";
import { verifyPayload } from "./stage-dashboard.mjs";

let failures = 0;
function fail(message) {
  failures += 1;
  process.stderr.write(`FAIL  ${message}\n`);
}
function pass(message) {
  process.stdout.write(`ok    ${message}\n`);
}

try { await verifyPayload(); pass("core/Vite payload provenance and contents verified"); }
catch (error) { fail(`core/Vite payload: ${error.message}`); }

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

// Verify the staged bytes, even when they came from an earlier --no-build run.
const stagedFiles = fs.existsSync(stagingDir) ? walk(stagingDir) : [];
const pluginCopies = stagedFiles.filter((relative) => {
  const name = path.posix.basename(relative);
  if (["devhub-plugin.json", "devhub-mcp-toolsets.json", "plugin-desktop-icon.png"].includes(name)) return true;
  if (!/\.(?:js|mjs|cjs|json)$/.test(name) || relative.split("/").includes("node_modules")) return false;
  const body = fs.readFileSync(path.join(stagingDir, relative), "utf8");
  return /["']?sourceRoot["']?\s*:\s*["'][^"']+["']\s*,\s*["']?fingerprint["']?\s*:\s*["'][a-f0-9]{64}["']/.test(body);
});
const pluginIcon = path.join(stagingDir, "icons", "plugin.png");
const coreIcon = path.join(dashboardDir, "public", "icon-master.png");
if (fs.existsSync(pluginIcon) && (!fs.existsSync(coreIcon) || !fs.readFileSync(pluginIcon).equals(fs.readFileSync(coreIcon)))) pluginCopies.push("icons/plugin.png");
if (pluginCopies.length) fail(`plugin copies staged:\n      ${pluginCopies.slice(0, 20).join("\n      ")}`);
else pass("no plugin manifests, materialisation receipts or plugin icon in staging");

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
const personalResources = onDisk.filter((relative) => isPersonalSourcePath(relative) &&
  relative !== "persona/identity.txt" && relative !== "skills/shared/my-voice/writing-style.md");
if (personalResources.length > 0) {
  fail(`personal data staged in resources:\n      ${personalResources.slice(0, 20).join("\n      ")}`);
} else pass("no personal-data paths in the resources");

const writingStyle = path.join(resourcesDir, "skills/shared/my-voice/writing-style.md");
if (!fs.existsSync(writingStyle) || fs.readFileSync(writingStyle, "utf8") !== GENERIC_WRITING_STYLE) {
  fail("skills/shared/my-voice/writing-style.md is missing or not the generic default");
} else pass("packaged writing style is the generic default");

// The packaged identity must be the generic one, not this developer's.
const identity = path.join(resourcesDir, "persona", "identity.txt");
if (fs.existsSync(identity)) {
  const body = fs.readFileSync(identity, "utf8");
  if (body.includes("Make This Yours")) pass("packaged identity is the generic default");
  else fail("persona/identity.txt is not the generic default — a personal identity may have leaked");
}

// 3. Credential-shaped content, in resources and in the server bundle. Env
//    files are the realistic accident: a stray `.env.local` copied into the
//    payload ships real tokens.
const CREDENTIAL_FILES = [/(^|\/)\.env(\.|$)/, /\.pem$/i, /\.key$/i, /id_rsa/i];
const serverFiles = fs.existsSync(serverDir) ? walk(serverDir) : [];
const serverVoiceFiles = serverFiles.filter((file) => /(^|\/)skills\/shared\/my-voice\/(writing-style|learned-voice)\.md$/.test(file));
if (serverVoiceFiles.length > 0) {
  fail(`personal voice paths staged in the server:\n      ${serverVoiceFiles.slice(0, 20).join("\n      ")}`);
} else pass("no personal voice paths in the server");
const suspects = [...onDisk, ...serverFiles].filter((p) => CREDENTIAL_FILES.some((re) => re.test(p)));
if (suspects.length > 0) {
  fail(`credential-shaped files staged:\n      ${suspects.slice(0, 20).join("\n      ")}`);
} else {
  pass("no credential-shaped files in the bundle");
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

// Reject links that would escape or dangle after packaging.
{
  const offenders = [];
  const scan = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const resolved = path.resolve(path.dirname(full), fs.readlinkSync(full));
        const rel = path.relative(serverDir, full);
        if (!fs.existsSync(resolved)) offenders.push(`${rel} -> ${fs.readlinkSync(full)} (dangling)`);
        else if (path.relative(serverDir, resolved).startsWith("..")) {
          offenders.push(`${rel} -> ${resolved} (escapes the bundle)`);
        }
      } else if (entry.isDirectory()) scan(full);
    }
  };
  scan(serverDir);

  if (offenders.length > 0) {
    fail(
      `${offenders.length} staged symlink(s) will not resolve on another machine:\n      ` +
        offenders.slice(0, 10).join("\n      "),
    );
  } else {
    pass("every staged symlink resolves inside the bundle");
  }
}

process.stdout.write(
  failures === 0
    ? "\nStaging verified — safe to sign.\n"
    : `\n${failures} check(s) failed. Refusing to sign this bundle.\n`,
);
process.exit(failures === 0 ? 0 : 1);
