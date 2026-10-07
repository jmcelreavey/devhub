#!/usr/bin/env node
/** Bundle GitHub sign-in and private-repo setup without requiring Homebrew. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { binariesDir, desktopDir } from "./staging-paths.mjs";

const manifest = JSON.parse(fs.readFileSync(path.join(desktopDir, "github-cli.json"), "utf8"));
const cacheDir = path.join(desktopDir, ".cache", "github-cli");

function digest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export async function stageGithubCli({ platform = os.platform(), arch = os.arch() } = {}) {
  const key = `${platform}-${arch}`;
  const artifact = manifest.artifacts[key];
  if (!artifact) throw new Error(`No pinned GitHub CLI for ${key}`);
  fs.mkdirSync(cacheDir, { recursive: true });
  const archive = path.join(cacheDir, artifact.file);
  if (!fs.existsSync(archive) || digest(archive) !== artifact.sha256) {
    const url = `${manifest.baseUrl}/v${manifest.version}/${artifact.file}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`GitHub CLI download failed: HTTP ${response.status}`);
    fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
  }
  // Verify against the committed digest before extracting or executing anything.
  if (digest(archive) !== artifact.sha256) {
    fs.rmSync(archive, { force: true });
    throw new Error(`GitHub CLI checksum mismatch for ${artifact.file}`);
  }

  const extractDir = fs.mkdtempSync(path.join(cacheDir, "extract-"));
  try {
    const zip = archive.endsWith(".zip");
    const args = zip ? ["-oq", archive, "-d", extractDir] : ["-xzf", archive, "-C", extractDir];
    execFileSync(zip ? "unzip" : "tar", args, { timeout: 30_000, stdio: "inherit" });
    const extracted = path.join(extractDir, artifact.file.replace(/\.(zip|tar\.gz)$/, ""));
    const binary = path.join(extracted, "bin", "gh");
    const license = path.join(extracted, "LICENSE");
    fs.mkdirSync(binariesDir, { recursive: true });
    const destination = path.join(binariesDir, "gh");
    fs.copyFileSync(binary, destination);
    fs.copyFileSync(license, path.join(binariesDir, "gh-LICENSE"));
    fs.chmodSync(destination, 0o755);
    if (platform === "darwin") {
      execFileSync("codesign", ["--force", "--sign", "-", "--timestamp=none", destination], { timeout: 30_000 });
    }
    const version = execFileSync(destination, ["--version"], { encoding: "utf8", timeout: 10_000 }).split("\n")[0];
    if (!version.startsWith(`gh version ${manifest.version} `)) {
      throw new Error(`Staged GitHub CLI reports an unexpected version: ${version}`);
    }
    process.stdout.write(`[stage-gh] ${version}\n`);
    return destination;
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  stageGithubCli().catch((err) => {
    process.stderr.write(`[stage-gh] ${err.message}\n`);
    process.exit(1);
  });
}
