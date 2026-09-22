#!/usr/bin/env node
/**
 * Starts the DevHub MCP server from a cached esbuild bundle.
 *
 * Every client (Claude, Codex, Cursor, OpenCode…) spawns this server at
 * session start. Running `src/mcp.ts` through tsx transpiles ~120 files each
 * time (~500 ms); the bundle starts in ~220 ms. The bundle is rebuilt whenever
 * any source under `src/` or the repo's `shared/` is newer than it, so a
 * checkout edit is live on the next spawn — never a stale build.
 *
 * If the build fails, fall back to tsx so a broken bundler never takes the
 * server down.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(serverRoot, "../..");
const entry = path.join(serverRoot, "src", "mcp.ts");
const bundle = path.join(serverRoot, "dist", "mcp.mjs");
const SOURCE_DIRS = [path.join(serverRoot, "src"), path.join(repoRoot, "shared")];

// Two modules derive the repo root from import.meta.url, which points at the
// bundle once bundled. Pinning it here keeps both correct.
process.env.REPO_ROOT ||= repoRoot;

function newestSourceMtime(dir) {
  let newest = 0;
  if (!fs.existsSync(dir)) return newest;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name === "node_modules") continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) newest = Math.max(newest, newestSourceMtime(full));
    else if (item.name.endsWith(".ts")) newest = Math.max(newest, fs.statSync(full).mtimeMs);
  }
  return newest;
}

function bundleIsFresh() {
  if (!fs.existsSync(bundle)) return false;
  const built = fs.statSync(bundle).mtimeMs;
  // This file holds the build options, so editing it invalidates the bundle too.
  if (fs.statSync(fileURLToPath(import.meta.url)).mtimeMs > built) return false;
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
