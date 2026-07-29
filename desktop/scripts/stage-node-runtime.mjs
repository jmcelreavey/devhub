#!/usr/bin/env node
/**
 * Download, verify, and stage the Node runtime the app ships with.
 *
 * The installed app must run without a system Node, so one comes along for the
 * ride. That is the single biggest reason this bundle is ~100 MB rather than
 * ~15 MB, and it is a deliberate trade: `node-pty` is a native module and Next
 * standalone traces a real dependency graph. Forcing both through a
 * single-executable packager buys a smaller number on a download page and pays
 * for it in failure modes that only appear on other people's machines.
 *
 * Verification is against digests committed in `node-runtime.json`, not against
 * a checksum file fetched from the same server as the tarball. The second
 * proves the download was not corrupted in transit; only the first proves we
 * are signing and shipping the bytes somebody reviewed.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { binariesDir, desktopDir } from "./staging-paths.mjs";

const manifest = JSON.parse(fs.readFileSync(path.join(desktopDir, "node-runtime.json"), "utf8"));
const cacheDir = path.join(desktopDir, ".cache", "node-runtime");

function log(msg) {
  process.stdout.write(`[stage-node] ${msg}\n`);
}

/** `darwin-arm64` style key for a platform/arch pair. */
function artifactKey(platform = os.platform(), arch = os.arch()) {
  return `${platform}-${arch}`;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

async function download(url, dest) {
  log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status} ${res.statusText}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

/**
 * Extract just the `bin/node` binary.
 *
 * npm, npx, corepack, and the bundled headers are all things the app never
 * runs and would otherwise have to be signed, notarised, and shipped. The
 * sidecar executes exactly one program.
 */
function extractNodeBinary(archive, key, into) {
  fs.mkdirSync(into, { recursive: true });
  if (archive.endsWith(".zip")) {
    execFileSync("unzip", ["-oq", archive, "-d", into], { stdio: "inherit" });
  } else {
    const flag = archive.endsWith(".xz") ? "-xJf" : "-xzf";
    execFileSync("tar", [flag, archive, "-C", into], { stdio: "inherit" });
  }
  const root = fs
    .readdirSync(into, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("node-v"))
    .map((e) => path.join(into, e.name))[0];
  if (!root) throw new Error(`Could not find the extracted Node directory in ${into}`);
  const bin = key.startsWith("win-") || key.startsWith("win32-")
    ? path.join(root, "node.exe")
    : path.join(root, "bin", "node");
  if (!fs.existsSync(bin)) throw new Error(`Extracted archive has no node binary at ${bin}`);
  return bin;
}

export async function stageNodeRuntime({ platform = os.platform(), arch = os.arch() } = {}) {
  const key = artifactKey(platform, arch);
  const artifact = manifest.artifacts[key];
  if (!artifact) {
    throw new Error(
      `No pinned Node runtime for ${key}. Add it to desktop/node-runtime.json with a verified digest before advertising that target.`,
    );
  }

  const url = `${manifest.baseUrl}/v${manifest.version}/${artifact.file}`;
  const archive = path.join(cacheDir, artifact.file);

  if (fs.existsSync(archive) && sha256(archive) === artifact.sha256) {
    log(`cached ${artifact.file} (digest matches)`);
  } else {
    await download(url, archive);
    const actual = sha256(archive);
    if (actual !== artifact.sha256) {
      fs.rmSync(archive, { force: true });
      throw new Error(
        `Checksum mismatch for ${artifact.file}\n  expected ${artifact.sha256}\n  actual   ${actual}\n` +
          `Refusing to stage an unverified runtime. If the upstream artifact genuinely changed, update node-runtime.json deliberately.`,
      );
    }
    log(`verified ${artifact.file}`);
  }

  const extractDir = path.join(cacheDir, `extract-${key}`);
  fs.rmSync(extractDir, { recursive: true, force: true });
  const nodeBin = extractNodeBinary(archive, key, extractDir);

  // Tauri resolves external binaries by target-triple suffix; without it the
  // bundle builds and the app cannot find its own runtime at launch.
  const ext = platform === "win32" ? ".exe" : "";
  const dest = path.join(binariesDir, `node-${artifact.targetTriple}${ext}`);
  fs.mkdirSync(binariesDir, { recursive: true });

  /*
   * Exactly one runtime in the bundle.
   *
   * This directory ships wholesale as a resource, so a leftover from a
   * different target rides along: after one Linux container build, the macOS
   * app contained a 116 MB `node-aarch64-unknown-linux-gnu` it could never
   * execute, nearly doubling the download for nothing.
   */
  for (const existing of fs.readdirSync(binariesDir)) {
    if (existing.startsWith("node-") && existing !== path.basename(dest)) {
      fs.rmSync(path.join(binariesDir, existing), { force: true });
      log(`removed stale runtime for another target: ${existing}`);
    }
  }
  fs.copyFileSync(nodeBin, dest);
  fs.chmodSync(dest, 0o755);
  // Copying a signed Mach-O invalidates its CodeDirectory on recent macOS.
  // Re-sign before the smoke test; the finished app is signed again after bundling.
  if (platform === "darwin") {
    execFileSync("codesign", ["--force", "--sign", "-", "--timestamp=none", dest]);
  }
  fs.rmSync(extractDir, { recursive: true, force: true });

  const version = execFileSync(dest, ["--version"], { encoding: "utf8" }).trim();
  if (version !== `v${manifest.version}`) {
    throw new Error(`Staged runtime reports ${version}, expected v${manifest.version}`);
  }
  log(`staged ${path.relative(desktopDir, dest)} (${version})`);
  return dest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  stageNodeRuntime().catch((err) => {
    process.stderr.write(`[stage-node] ${err.message}\n`);
    process.exit(1);
  });
}
