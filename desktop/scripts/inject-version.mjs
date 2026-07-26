#!/usr/bin/env node
/**
 * One version, injected everywhere from the git tag.
 *
 * There are four places a version can appear — `tauri.conf.json`, `Cargo.toml`,
 * the About dialog, and the health endpoint — and four places is four chances
 * to disagree. A release where the DMG says 2.1.0 and the About box says 2.0.0
 * is a release nobody can support, and worse, the updater compares versions:
 * a stale number in `tauri.conf.json` means clients on 2.1.0 are told 2.1.0 is
 * available, forever.
 *
 * So the tag is the single source and this script writes it into the two files
 * that are read at build time. The About dialog and health endpoint both read
 * `CARGO_PKG_VERSION` / `DEVHUB_VERSION` at runtime rather than hardcoding.
 *
 * Usage: node desktop/scripts/inject-version.mjs 2.1.0
 */
import fs from "node:fs";
import path from "node:path";
import { tauriDir } from "./staging-paths.mjs";

const raw = process.argv[2];
if (!raw) {
  process.stderr.write("usage: inject-version.mjs <version>\n");
  process.exit(1);
}

// Strip a leading `v` so both `v2.1.0` and `2.1.0` work; Cargo and Tauri both
// want the bare semver.
const version = raw.replace(/^v/, "");
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  process.stderr.write(
    `Refusing to release version "${version}": not semver. The updater compares these, so a malformed one strands clients.\n`,
  );
  process.exit(1);
}

const confPath = path.join(tauriDir, "tauri.conf.json");
const conf = JSON.parse(fs.readFileSync(confPath, "utf8"));
conf.version = version;
fs.writeFileSync(confPath, `${JSON.stringify(conf, null, 2)}\n`);

const cargoPath = path.join(tauriDir, "Cargo.toml");
const cargo = fs.readFileSync(cargoPath, "utf8");
const patched = cargo.replace(/^version = ".*"$/m, `version = "${version}"`);
if (patched === cargo) {
  process.stderr.write(`Could not find a version line to replace in ${cargoPath}\n`);
  process.exit(1);
}
fs.writeFileSync(cargoPath, patched);

process.stdout.write(`[version] set tauri.conf.json and Cargo.toml to ${version}\n`);
