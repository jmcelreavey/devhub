#!/usr/bin/env node
/**
 * Build the Linux bundle in a container.
 *
 * Tauri's Linux target needs WebKitGTK, which does not exist on macOS, so
 * cross-compiling from a Mac is not an option — the webview is a system
 * library, not something Rust can link statically. A container gives the real
 * thing.
 *
 * Ubuntu 22.04 rather than latest: WebKitGTK links against glibc, and a binary
 * built on a newer glibc refuses to start on an older one. Building on the
 * oldest distribution you intend to support is the only way to get a bundle
 * that runs on all of them.
 *
 * Usage:
 *   node apps/desktop/scripts/build-linux.mjs [--shell]
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { dashboardDir, desktopDir, repoRoot } from "./staging-paths.mjs";

const IMAGE = "devhub-linux-builder";
const DOCKERFILE = path.join(desktopDir, "docker", "linux-builder.Dockerfile");
const containerPath = (dir) => `/work/${path.relative(repoRoot, dir).split(path.sep).join("/")}`;
const containerDesktop = containerPath(desktopDir);
const containerDashboard = containerPath(dashboardDir);

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (result.status !== 0) {
    process.stderr.write(`\n[linux] ${cmd} ${args.slice(0, 3).join(" ")}… failed\n`);
    process.exit(result.status ?? 1);
  }
  return result;
}

if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) {
  process.stderr.write("[linux] Docker is not running. Start Docker Desktop and retry.\n");
  process.exit(1);
}

process.stdout.write("[linux] building the toolchain image (cached after the first run)\n");
run("docker", ["build", "-t", IMAGE, "-f", DOCKERFILE, desktopDir]);

/**
 * The repo is mounted rather than copied so the build sees the current working
 * tree — this is a local build tool, not a hermetic release. CI does the
 * hermetic version.
 *
 * `target-linux/` is a separate directory: sharing `target/` between the host
 * and the container means every switch between macOS and Linux invalidates the
 * whole cache, and the two produce incompatible artefacts anyway.
 */
const args = [
  "run",
  "--rm",
  process.stdout.isTTY ? "-it" : "-i",
  "-v",
  `${repoRoot}:/work`,
  "-w",
  "/work",
  "-e",
  `CARGO_TARGET_DIR=${containerDesktop}/src-tauri/target-linux`,
  "-e",
  `DEVHUB_LINUX_DESKTOP_DIR=${containerDesktop}`,
  "-e",
  `DEVHUB_LINUX_UI_DIR=${containerDashboard}`,
  "-e",
  "DEVHUB_LINUX_ISOLATED_MODULES=1",
  "-e",
  `NODE_OPTIONS=${process.env.NODE_OPTIONS || "--max-old-space-size=6144"}`,
];

// Anonymous volumes hide every host workspace dependency tree, including
// nested trees npm may create for conflicting versions. Docker removes them
// with the container, so Linux binaries never replace host binaries.
for (const dir of ["node_modules", "apps/core/node_modules", "apps/ui/node_modules", "apps/desktop/node_modules", "packages/shared/node_modules", "packages/mcp/node_modules", "packages/qa/node_modules"]) {
  args.push("--mount", `type=volume,destination=/work/${dir},volume-nocopy`);
}

for (const dir of [`${containerDesktop}/staging`, `${containerDesktop}/src-tauri/binaries`]) {
  args.push("--mount", `type=volume,destination=${dir},volume-nocopy`);
}

args.push(IMAGE);

if (process.argv.includes("--shell")) {
  process.stdout.write("[linux] opening a shell in the builder\n");
  run("docker", [...args, "bash"]);
  process.exit(0);
}

run("docker", [...args, "bash", "-lc", 'bash "$DEVHUB_LINUX_DESKTOP_DIR/scripts/build-linux-inner.sh"']);

const bundleDir = path.join(desktopDir, "src-tauri", "target-linux", "release", "bundle");
if (fs.existsSync(bundleDir)) {
  process.stdout.write("\n[linux] artefacts:\n");
  for (const kind of ["appimage", "deb"]) {
    const dir = path.join(bundleDir, kind);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      const size = (fs.statSync(path.join(dir, file)).size / 1024 / 1024).toFixed(1);
      process.stdout.write(`  ${path.relative(repoRoot, path.join(dir, file))} (${size} MB)\n`);
    }
  }
}
