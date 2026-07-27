#!/usr/bin/env node
/**
 * Find the built app and run its packaged `--self-test`.
 *
 * A thin wrapper on purpose: the self-test itself lives in the shipped binary,
 * so CI and a post-install check run *exactly* the same code the user's copy
 * would. A separate test harness would prove the harness works.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { tauriDir } from "./staging-paths.mjs";

/**
 * Find the bundled Node runtime.
 *
 * It moved from `Contents/MacOS/` to `Contents/Resources/runtime/` because
 * macOS gave anything in `MacOS/` a Dock icon — the sidecar showed up as a
 * bouncing "node" the user could not interact with. Both locations are
 * checked so an app installed before that change still self-tests.
 */
function findNode(root) {
  const candidates = [
    path.join(root, "Contents", "Resources", "runtime"),
    path.join(root, "Contents", "MacOS"),
    path.join(root, "runtime"),
    root,
  ];
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    const exact = path.join(dir, "node");
    if (fs.existsSync(exact)) return exact;
    const suffixed = fs
      .readdirSync(dir)
      .find((f) => f.startsWith("node-") && !f.endsWith(".sig"));
    if (suffixed) return path.join(dir, suffixed);
  }
  return path.join(root, "Contents", "Resources", "runtime", "node");
}

const targetArg = process.argv.indexOf("--target");
const target = targetArg !== -1 ? process.argv[targetArg + 1] : null;

/** Prefer an explicitly built target dir, then release, then debug. */
function candidates() {
  const base = path.join(tauriDir, "target");
  const dirs = [];
  if (target) dirs.push(path.join(base, target, "release"), path.join(base, target, "debug"));
  dirs.push(path.join(base, "release"), path.join(base, "debug"));
  return dirs.filter((d) => fs.existsSync(d));
}

function findBundle() {
  for (const dir of candidates()) {
    // macOS: the .app carries its Resources, which is what the self-test needs.
    const app = path.join(dir, "bundle", "macos", "DevHub.app");
    if (fs.existsSync(app)) {
      // The executable is named after the Cargo binary, not the product, and
      // guessing "DevHub" gives an ENOENT that reads like a missing build.
      // Info.plist is the authority.
      const macos = path.join(app, "Contents", "MacOS");
      const plist = fs.readFileSync(path.join(app, "Contents", "Info.plist"), "utf8");
      const named = plist.match(/<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/);
      const bin = path.join(macos, named?.[1] ?? "devhub-desktop");
      return {
        bin,
        resources: path.join(app, "Contents", "Resources"),
        node: findNode(app),
      };
    }
    // Linux / raw binary: resources sit beside the executable.
    const bin = path.join(dir, "devhub-desktop");
    if (fs.existsSync(bin)) {
      return { bin, resources: dir, node: findNode(dir) };
    }
  }
  return null;
}

const bundle = findBundle();
if (!bundle) {
  process.stderr.write(
    `No built app found under ${path.join(tauriDir, "target")}. Run npm run desktop:build first.\n`,
  );
  process.exit(1);
}

process.stdout.write(`[selftest] ${bundle.bin}\n`);

const result = spawnSync(bundle.bin, ["--self-test"], {
  stdio: "inherit",
  env: {
    ...process.env,
    DEVHUB_SELFTEST_RESOURCES: bundle.resources,
    DEVHUB_SELFTEST_NODE: bundle.node,
  },
  timeout: 5 * 60 * 1000,
});

if (result.error) {
  process.stderr.write(`[selftest] ${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
