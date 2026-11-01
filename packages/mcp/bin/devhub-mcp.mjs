#!/usr/bin/env node
/**
 * Starts the DevHub MCP server from a cached esbuild bundle.
 *
 * Every client (Claude, Codex, Cursor, OpenCode…) spawns this server at
 * session start. Running `src/mcp.ts` through tsx transpiles ~120 files each
 * time (~500 ms); the bundle starts in ~220 ms. The bundle is rebuilt whenever
 * any source under `src/`, `apps/core/src/`, `packages/shared/`, or the dashboard plugin validator is newer, so a
 * checkout edit is live on the next spawn — never a stale build.
 *
 * If the build fails, fall back to tsx so a broken bundler never takes the
 * server down.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sharedZodPlugin } from "./shared-zod.mjs";
import { resolveWorkspacePaths, resolveWorkspaceRoot } from "../../../scripts/workspace-paths.mjs";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolveWorkspaceRoot(serverRoot);
const workspace = resolveWorkspacePaths(repoRoot);
const sharedActionsRoot = workspace.sharedActionsDir;
const entry = path.join(serverRoot, "src", "mcp.ts");
const bundle = path.join(serverRoot, "dist", "mcp.mjs");
const SOURCE_DIRS = [path.join(serverRoot, "src"), path.join(repoRoot, "apps", "core", "src"), sharedActionsRoot, path.join(workspace.dashboardDir, "lib", "plugins")];

// Two modules derive the repo root from import.meta.url, which points at the
// bundle once bundled. Pinning it here keeps both correct.
process.env.REPO_ROOT ||= repoRoot;

function newestSourceMtime(dir) {
  if (!fs.existsSync(dir)) {
    let ancestor = path.dirname(dir);
    while (!fs.existsSync(ancestor) && path.dirname(ancestor) !== ancestor) ancestor = path.dirname(ancestor);
    return fs.statSync(ancestor).mtimeMs;
  }
  let newest = fs.statSync(dir).mtimeMs;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name === "node_modules") continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) newest = Math.max(newest, newestSourceMtime(full));
    else if (/\.(?:[cm]?[jt]sx?|json)$/.test(item.name)) newest = Math.max(newest, fs.statSync(full).mtimeMs);
  }
  return newest;
}

function bundleIsFresh() {
  if (!fs.existsSync(bundle)) return false;
  const built = fs.statSync(bundle).mtimeMs;
  // This file holds the build options, so editing it invalidates the bundle too.
  if (fs.statSync(fileURLToPath(import.meta.url)).mtimeMs > built) return false;
  for (const file of [path.join(serverRoot, "bin", "shared-zod.mjs"), path.join(repoRoot, "scripts", "workspace-paths.mjs"), path.join(sharedActionsRoot, "package.json")]) {
    if (fs.statSync(file).mtimeMs > built) return false;
  }
  const lockfile = path.join(repoRoot, "package-lock.json");
  if (fs.existsSync(lockfile) && fs.statSync(lockfile).mtimeMs > built) return false;
  return SOURCE_DIRS.every((dir) => newestSourceMtime(dir) <= built);
}

async function buildBundle() {
  const { build, stop } = await import("esbuild");
  // Several clients can start at once; write to a private file and rename so
  // none of them ever imports a half-written bundle.
  const tmp = `${bundle}.${process.pid}.tmp`;
  try {
    await build({
      entryPoints: [entry],
      outfile: tmp,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      packages: "external",
      plugins: [sharedZodPlugin(sharedActionsRoot)],
      logLevel: "silent",
    });
    fs.renameSync(tmp, bundle);
  } finally {
    fs.rmSync(tmp, { force: true });
    // The JS API keeps an esbuild service process alive for reuse; this
    // server builds once, so without stop() it idled for the server's lifetime.
    await stop();
  }
}

let useBundle = true;
if (!bundleIsFresh()) {
  try {
    await buildBundle();
  } catch (error) {
    useBundle = false;
    process.stderr.write(
      `[devhub-mcp] bundle build failed (${error instanceof Error ? error.message : String(error)}); running from source via tsx\n`,
    );
  }
}

// Only the build is guarded: a runtime error in the server itself must
// surface, not start a second copy on the same stdio.
if (useBundle) {
  await import(pathToFileURL(bundle).href);
} else {
  const { register } = await import("tsx/esm/api");
  register();
  await import(pathToFileURL(entry).href);
}
