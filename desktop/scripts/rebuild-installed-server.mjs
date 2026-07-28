#!/usr/bin/env node
/**
 * What "Rebuild Dashboard" in the Tauri menu actually needs to do.
 *
 * Plain `npm run build` only refreshes `dashboard/.next` in the checkout.
 * The packaged app serves `/Applications/DevHub.app/.../Resources/server`
 * (or the staging dir under `desktop:dev`), so that build never reaches the
 * UI the user is staring at — which is how a chip fix can be on HEAD and
 * still invisible after Rebuild.
 *
 * This script:
 *   1. Stages a standalone Next server from the checkout
 *   2. Copies it over DEVHUB_SERVER_DIR (the running app's server tree)
 *
 * The shell sets DEVHUB_SERVER_DIR from resolve_paths().server_dir.
 */
import fs from "node:fs";
import path from "node:path";
import { stageDashboard } from "./stage-dashboard.mjs";
import { serverDir as stagedServerDir } from "./staging-paths.mjs";

function fail(msg) {
  process.stderr.write(`[rebuild-installed-server] ${msg}\n`);
  process.exit(1);
}

function log(msg) {
  process.stdout.write(`[rebuild-installed-server] ${msg}\n`);
}

const target = process.env.DEVHUB_SERVER_DIR?.trim();
if (!target) {
  fail(
    "DEVHUB_SERVER_DIR is required. The desktop shell should pass the packaged server path.",
  );
}
if (!path.isAbsolute(target)) {
  fail(`DEVHUB_SERVER_DIR must be absolute (got ${target})`);
}

const targetServerJs = path.join(target, "server.js");
if (!fs.existsSync(targetServerJs)) {
  fail(
    `No server.js at ${target}. Refusing to invent a server tree outside the installed app.`,
  );
}

log(`staging dashboard for install into ${target}`);
await stageDashboard({ build: true });

if (!fs.existsSync(path.join(stagedServerDir, "server.js"))) {
  fail(`stage-dashboard produced no server.js at ${stagedServerDir}`);
}

log(`replacing ${target}`);
// Replace contents rather than rmSync(target): the directory inode may be the
// app's Resources/server, and wiping the directory itself is unnecessary.
for (const entry of fs.readdirSync(target)) {
  fs.rmSync(path.join(target, entry), { recursive: true, force: true });
}
fs.cpSync(stagedServerDir, target, { recursive: true, dereference: true });

if (!fs.existsSync(path.join(target, "server.js"))) {
  fail(`copy failed — ${target}/server.js missing after sync`);
}
if (!fs.existsSync(path.join(target, ".next", "static"))) {
  fail(`copy failed — ${target}/.next/static missing after sync`);
}

log("done");
