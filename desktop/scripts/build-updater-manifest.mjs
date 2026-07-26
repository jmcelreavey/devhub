#!/usr/bin/env node
/**
 * Generate `latest.json` — the file every installed client polls.
 *
 * Generated rather than hand-maintained because the failure mode of getting it
 * wrong is silent and one-directional: clients on the previous version check a
 * manifest with a bad URL or a mismatched signature, the update fails, and
 * nobody tells you. They just stop getting updates.
 *
 * Two rules enforced here:
 *
 * - **Every platform entry must have a signature.** Tauri refuses to install
 *   without one, so an entry lacking a `.sig` is an entry that is broken for
 *   every user on that platform. That is a build failure, not a warning.
 * - **Only updater artifacts are listed.** A `.dmg` is an installer a human
 *   downloads; the updater consumes `.app.tar.gz` and `.AppImage`. Listing a
 *   DMG here produces an update that downloads and then does nothing.
 *
 * Usage: build-updater-manifest.mjs <dist-dir> <version>
 */
import fs from "node:fs";
import path from "node:path";

const [distDir, version] = process.argv.slice(2);
if (!distDir || !version) {
  process.stderr.write("usage: build-updater-manifest.mjs <dist-dir> <version>\n");
  process.exit(1);
}

const repo = process.env.GITHUB_REPOSITORY;
if (!repo) {
  process.stderr.write("GITHUB_REPOSITORY is not set — cannot build download URLs.\n");
  process.exit(1);
}
const tag = process.env.GITHUB_REF_NAME ?? `v${version}`;
const downloadBase = `https://github.com/${repo}/releases/download/${tag}`;

/**
 * Map a built artifact to a Tauri updater platform key.
 *
 * The mapping is by filename because that is what the bundler gives us. It is
 * deliberately strict: an unrecognised artifact is skipped rather than guessed
 * at, since a wrong platform key sends a macOS user a Linux binary.
 */
function platformFor(file) {
  if (file.endsWith(".app.tar.gz")) {
    if (file.includes("aarch64") || file.includes("arm64")) return "darwin-aarch64";
    if (file.includes("x64") || file.includes("x86_64")) return "darwin-x86_64";
    // Tauri's default macOS bundle name carries no arch. Refusing to guess:
    // a mislabelled entry breaks updates for one whole architecture.
    return null;
  }
  if (file.endsWith(".AppImage")) {
    if (file.includes("aarch64") || file.includes("arm64")) return "linux-aarch64";
    return "linux-x86_64";
  }
  return null;
}

const files = fs.readdirSync(distDir);
const platforms = {};
const skipped = [];

for (const file of files) {
  const key = platformFor(file);
  if (!key) {
    if (file.endsWith(".app.tar.gz")) skipped.push(file);
    continue;
  }
  const sigFile = `${file}.sig`;
  if (!files.includes(sigFile)) {
    process.stderr.write(
      `No signature for ${file}. Tauri will not install an unsigned update, so publishing this would break ${key} clients.\n`,
    );
    process.exit(1);
  }
  platforms[key] = {
    signature: fs.readFileSync(path.join(distDir, sigFile), "utf8").trim(),
    url: `${downloadBase}/${encodeURIComponent(file)}`,
  };
}

if (skipped.length > 0) {
  process.stderr.write(
    `Could not determine the architecture of: ${skipped.join(", ")}\n` +
      `Rename the artifact to include the target triple, or these users get no updates.\n`,
  );
  process.exit(1);
}

if (Object.keys(platforms).length === 0) {
  process.stderr.write("No updater artifacts found. Is bundle.createUpdaterArtifacts still true?\n");
  process.exit(1);
}

const manifest = {
  version,
  notes: `See https://github.com/${repo}/releases/tag/${tag}`,
  pub_date: new Date().toISOString(),
  platforms,
};

fs.writeFileSync(path.join(distDir, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(
  `[updater] latest.json for ${version} covering: ${Object.keys(platforms).join(", ")}\n`,
);
