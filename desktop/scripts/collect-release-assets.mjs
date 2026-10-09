#!/usr/bin/env node
/**
 * Flatten the downloaded release artifacts into one directory the publish
 * steps can glob.
 *
 * Two things make the raw download unusable as-is:
 *
 * - `upload-artifact` roots each artifact at the least common ancestor of its
 *   search paths, so installers arrive nested under
 *   `<triple>/release/bundle/<kind>/`, while the manifest builder and the
 *   release globs expect a flat directory.
 * - Tauri names the macOS updater tarball `DevHub.app.tar.gz` with no arch, so
 *   the aarch64 and x64 builds collide once flattened — and the manifest
 *   builder rightly refuses an arch-less tarball. The arch is recovered from
 *   the target-triple directory the file was built under. If there is none we
 *   fail rather than guess: a mislabelled tarball breaks updates for a whole
 *   architecture.
 *
 * Usage: collect-release-assets.mjs <src-dir> <dest-dir> <version>
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const COLLECTED_SUFFIXES = [
  ".dmg",
  ".app.tar.gz",
  ".app.tar.gz.sig",
  ".AppImage",
  ".AppImage.sig",
  ".deb",
  "-setup.exe",
  "-setup.exe.sig",
];

const MAC_ARCH_BY_TRIPLE = {
  "aarch64-apple-darwin": "aarch64",
  "x86_64-apple-darwin": "x64",
};

// Same markers build-updater-manifest.mjs uses to decide a name carries an arch.
const ARCH_MARKER = /aarch64|arm64|x64|x86_64/;

/**
 * Decide the flat destination name for each collectable file.
 *
 * Pure so it can be tested without a filesystem. `relativePaths` are relative
 * to the download root, `/`- or platform-separated.
 *
 * @returns {{ src: string, dest: string }[]}
 */
export function planAssets(relativePaths, version) {
  const plan = [];
  const taken = new Map();

  for (const src of relativePaths) {
    const segments = src.split(/[\\/]/);
    const name = segments[segments.length - 1];
    if (!COLLECTED_SUFFIXES.some((suffix) => name.endsWith(suffix))) continue;

    const dest = renameMacTarball(name, segments.slice(0, -1), src, version);
    if (taken.has(dest)) {
      throw new Error(`Both ${taken.get(dest)} and ${src} would be published as ${dest}.`);
    }
    taken.set(dest, src);
    plan.push({ src, dest });
  }
  return plan;
}

function renameMacTarball(name, dirs, src, version) {
  const isSig = name.endsWith(".sig");
  const base = isSig ? name.slice(0, -".sig".length) : name;
  if (!base.endsWith(".app.tar.gz") || ARCH_MARKER.test(base)) return name;

  const triple = dirs.find((dir) => dir in MAC_ARCH_BY_TRIPLE);
  if (!triple) {
    throw new Error(
      `${src} has no arch in its name and no known macOS target triple in its path ` +
        `(${Object.keys(MAC_ARCH_BY_TRIPLE).join(", ")}). Refusing to guess its architecture.`,
    );
  }
  const product = base.slice(0, -".app.tar.gz".length);
  return `${product}_${version}_${MAC_ARCH_BY_TRIPLE[triple]}.app.tar.gz${isSig ? ".sig" : ""}`;
}

function listFiles(root) {
  return fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)));
}

function main() {
  const [srcDir, destDir, version] = process.argv.slice(2);
  if (!srcDir || !destDir || !version) {
    process.stderr.write("usage: collect-release-assets.mjs <src-dir> <dest-dir> <version>\n");
    process.exit(1);
  }

  let plan;
  try {
    plan = planAssets(listFiles(srcDir), version);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  if (plan.length === 0) {
    process.stderr.write(`No release assets found under ${srcDir}.\n`);
    process.exit(1);
  }

  fs.mkdirSync(destDir, { recursive: true });
  for (const { src, dest } of plan) {
    const target = path.join(destDir, dest);
    // COPYFILE_EXCL: a leftover file in dest is a collision the plan can't see.
    fs.copyFileSync(path.join(srcDir, src), target, fs.constants.COPYFILE_EXCL);
    process.stdout.write(`${src} -> ${dest}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
