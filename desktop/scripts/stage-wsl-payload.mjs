#!/usr/bin/env node
/**
 * Build the Linux payload the Windows app installs into WSL.
 *
 * On Windows the Tauri app is only a window; the dashboard, terminal and agents
 * run in a WSL2 distro. This packs exactly what they need — the pinned Linux
 * Node runtime, the Next standalone server, the compiled services, generic
 * resources, and the WSL launcher — into one tarball, plus a content-derived id
 * the shell uses to decide whether this build is already unpacked.
 *
 * Must run on Linux (WSL is fine): node-pty and the traced node_modules are
 * native binaries for the machine that built them.
 *
 *   npm run stage:wsl            # full: build the dashboard, then pack
 *   npm run stage:wsl -- --no-build
 *
 * Output: staging/wsl/devhub-payload.tar.gz and staging/wsl/payload-id.txt,
 * which `tauri.windows.conf.json` bundles as resources.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { binariesDir, desktopDir, resourcesDir, serverDir, servicesDir, stagingDir } from "./staging-paths.mjs";
import { stageDashboard } from "./stage-dashboard.mjs";
import { stageNodeRuntime } from "./stage-node-runtime.mjs";
import { stageGithubCli } from "./stage-github-cli.mjs";
import { stageResources } from "./stage-resources.mjs";

const wslDir = path.join(stagingDir, "wsl");
const payloadDir = path.join(wslDir, "payload");

function log(msg) {
  process.stdout.write(`[stage-wsl] ${msg}\n`);
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

/** `cp -a`: preserves the exec bits and symlinks node_modules relies on. */
function copyTree(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  execFileSync("cp", ["-a", from, to]);
}

export async function stageWslPayload({ build = true } = {}) {
  if (os.platform() !== "linux") {
    throw new Error(
      "The WSL payload holds Linux native modules and must be built on Linux — run this inside WSL, not on Windows.",
    );
  }

  await stageNodeRuntime();
  await stageGithubCli();
  stageResources();
  await stageDashboard({ build });

  // The same leak gate the other platforms pass before signing. The payload is
  // a copy of these directories, so verifying the source is verifying it.
  const verify = spawnSync(process.execPath, [path.join(desktopDir, "scripts", "verify-staging.mjs")], {
    stdio: "inherit",
  });
  if (verify.status !== 0) throw new Error("verify-staging failed; refusing to pack a payload");

  const nodeBinary = fs.readdirSync(binariesDir).find((name) => name.startsWith("node-"));
  if (!nodeBinary) throw new Error(`No staged Node runtime in ${binariesDir}`);

  fs.rmSync(wslDir, { recursive: true, force: true });
  fs.mkdirSync(payloadDir, { recursive: true });

  copyTree(path.join(binariesDir, nodeBinary), path.join(payloadDir, "runtime", "node"));
  copyTree(path.join(binariesDir, "gh"), path.join(payloadDir, "runtime", "gh"));
  copyTree(path.join(binariesDir, "gh-LICENSE"), path.join(payloadDir, "runtime", "gh-LICENSE"));
  copyTree(serverDir, path.join(payloadDir, "server"));
  copyTree(servicesDir, path.join(payloadDir, "services"));
  copyTree(resourcesDir, path.join(payloadDir, "resources"));
  const launcher = path.join(payloadDir, "bin", "devhub-wsl-launch");
  copyTree(path.join(desktopDir, "wsl", "devhub-wsl-launch.sh"), launcher);
  fs.chmodSync(launcher, 0o755);

  const tarball = path.join(wslDir, "devhub-payload.tar.gz");
  // --owner/--group: extracted files should belong to the WSL user, not to
  // whatever uid built the tarball.
  execFileSync("tar", ["--owner=0", "--group=0", "-czf", tarball, "-C", payloadDir, "."], {
    stdio: "inherit",
  });
  fs.rmSync(payloadDir, { recursive: true, force: true });

  const id = sha256File(tarball).slice(0, 16);
  fs.writeFileSync(path.join(wslDir, "payload-id.txt"), `${id}\n`);
  const mb = (fs.statSync(tarball).size / 1024 / 1024).toFixed(0);
  log(`payload ${id} (${mb} MB) → ${path.relative(desktopDir, tarball)}`);
  return { id, tarball };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await stageWslPayload({ build: !process.argv.includes("--no-build") });
  } catch (err) {
    process.stderr.write(`[stage-wsl] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
