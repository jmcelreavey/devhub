#!/usr/bin/env node
/**
 * Pinned, machine-local Paseo daemon under launchd (macOS) or a systemd user
 * service (Linux, including WSL2). The service manager owns the process; no
 * PID/port killing. The daemon must run in the foreground under it:
 * `paseo start` without --foreground detaches, and Cursor's ACP agent then
 * fails with "Failed to initialize session services".
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";
import { execFileSync } from "node:child_process";
import { findBundledCodex, managedPaseoConfig, paseoDaemonArgs, usesWebUiConfig } from "./paseo-config.mjs";
import { installDevHubBootstrap } from "./paseo-web-bootstrap.mjs";
import { PASEO_SYSTEMD_UNIT, renderSystemdUnit } from "./paseo-service.mjs";

const updateRequested = process.argv.includes("--update");
const pinned = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "paseo-release.json"), "utf8"));
const root = path.join(os.homedir(), ".local", "share", "devhub", "paseo");
const home = path.join(root, "home");
const config = path.join(os.homedir(), ".config", "devhub");
const manifest = path.join(config, "paseo-managed.json");
const label = "devhub.paseo.daemon";
const port = 6767;
const uid = process.getuid?.();

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", timeout: 600_000, maxBuffer: 20_000_000, ...options });
}
function which(bin) {
  try { return run("/usr/bin/which", [bin], { timeout: 5000 }).trim() || null; } catch { return null; }
}
function pause(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
/** Right after a bootout, launchd can still be tearing the old job down and refuses a bootstrap. */
function bootstrap(file) {
  let error;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { run("/bin/launchctl", ["bootstrap", `gui/${uid}`, file], { timeout: 20_000 }); return; }
    catch (caught) { error = caught; pause(250 * (attempt + 1)); }
  }
  throw error;
}
function xml(s) { return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }

/** OPENCHAMBER_UI_PASSWORD is the legacy name, from when OpenChamber owned this password. */
function configuredPassword() {
  const file = path.join(import.meta.dirname, "..", "dashboard", ".env.local");
  const env = { ...(fs.existsSync(file) ? parseEnv(fs.readFileSync(file, "utf8")) : {}), ...process.env };
  const password = env.DEVHUB_PASEO_PASSWORD?.trim() || env.OPENCHAMBER_UI_PASSWORD?.trim();
  if (!password) throw new Error("Set an Agents password in DevHub Setup (DEVHUB_PASEO_PASSWORD in dashboard/.env.local) before setting up Paseo.");
  return password;
}

async function assertPortFree() {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error(`Port ${port} is occupied. Stop whatever holds it (another Paseo daemon? On Linux: \`systemctl --user disable --now paseo\`) before setup.`)));
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) })).ok) return; } catch { /* Startup is bounded below. */ }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Paseo did not start. Inspect ${path.join(root, label + ".log")}`);
}

function installedVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(root, "node_modules", "@getpaseo", "cli", "package.json"), "utf8")).version; } catch { return null; }
}

/** Safe-Chain is required for every npm install in DevHub; never fall back to plain npm. */
function installCli(version) {
  const npm = which("aikido-npm");
  if (!npm) throw new Error("Safe-Chain is required: install @aikidosec/safe-chain and run `safe-chain setup` (see README).");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const staging = fs.mkdtempSync(path.join(root, ".install-"));
  const names = ["node_modules", "package.json", "package-lock.json"];
  const moved = [];
  const rollback = () => {
    for (const name of moved.reverse()) {
      fs.rmSync(path.join(root, name), { recursive: true, force: true });
      const previous = path.join(staging, "previous-" + name);
      if (fs.existsSync(previous)) fs.renameSync(previous, path.join(root, name));
    }
    fs.rmSync(staging, { recursive: true, force: true });
  };
  try {
    fs.writeFileSync(path.join(staging, "package.json"), JSON.stringify({ private: true }), { mode: 0o600 });
    // The Paseo version already cleared Safe-Chain's minimum age (pinned, or picked by `npm view` through Safe-Chain);
    // its fresh transitive deps would otherwise block the install. Malware scanning still runs. An env var, not
    // --safe-chain-skip-minimum-package-age, because aikido-npm may spawn the shimmed npm, a second Safe-Chain that never sees the flag.
    run(npm, ["install", "--prefix", staging, "--save-exact", "--no-fund", "--no-audit", `@getpaseo/cli@${version}`], {
      env: { ...process.env, SAFE_CHAIN_MINIMUM_PACKAGE_AGE_HOURS: "0" },
    });
    run(process.execPath, [path.join(staging, "node_modules", "@getpaseo", "cli", "bin", "paseo"), "--version"], { timeout: 30_000 });
    for (const name of names) {
      const destination = path.join(root, name);
      if (fs.existsSync(destination)) fs.renameSync(destination, path.join(staging, "previous-" + name));
      moved.push(name);
      fs.renameSync(path.join(staging, name), destination);
    }
    return { rollback, commit: () => fs.rmSync(staging, { recursive: true, force: true }) };
  } catch (error) { rollback(); throw error; }
}

/** DevHub owns these keys; everything else in config.json (user providers, hostnames) is kept. */
function writeConfig(passwordHash, version) {
  const file = path.join(home, "config.json");
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { version: 1 };
  const next = managedPaseoConfig(current, {
    port, passwordHash, cursor: which("cursor-agent"), webUiConfig: usesWebUiConfig(version),
    codex: which("codex") || findBundledCodex(os.homedir()),
  });
  const temporary = `${file}.next`;
  fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(temporary, file);
}

/** The daemon finds claude, cursor-agent, opencode and codex on PATH, so it needs the user's. */
function daemonPath() {
  return [...new Set([path.dirname(process.execPath), ...(process.env.PATH || "/usr/bin:/bin").split(path.delimiter)]
    .filter(dir => dir && !dir.includes("node_modules") && fs.existsSync(dir)))].join(path.delimiter);
}

function registerSystemd(args) {
  const dir = path.join(os.homedir(), ".config", "systemd", "user");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, PASEO_SYSTEMD_UNIT);
  const unit = renderSystemdUnit({ root, home, args, path: daemonPath(), log: path.join(root, label + ".log") });
  fs.writeFileSync(`${file}.next`, unit, { mode: 0o600 });
  fs.renameSync(`${file}.next`, file);
  try {
    run("systemctl", ["--user", "daemon-reload"], { timeout: 30_000 });
    run("systemctl", ["--user", "enable", PASEO_SYSTEMD_UNIT], { timeout: 30_000 });
    // restart, not start: a reinstall or update changes the command line, and
    // start on a running unit would leave the old daemon in place.
    run("systemctl", ["--user", "restart", PASEO_SYSTEMD_UNIT], { timeout: 60_000 });
  } catch (error) {
    throw new Error("Could not start the Paseo service with systemd --user. In WSL, enable systemd (`[boot] systemd=true` in /etc/wsl.conf, then `wsl --shutdown`). " + (error instanceof Error ? error.message : ""));
  }
}

function register(args) {
  if (process.platform === "linux") return registerSystemd(args);
  const file = path.join(os.homedir(), "Library", "LaunchAgents", label + ".plist");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const log = path.join(root, label + ".log");
  const plist = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>' +
    '<key>Label</key><string>' + label + '</string><key>ProgramArguments</key><array>' + args.map((a) => '<string>' + xml(a) + '</string>').join("") + '</array>' +
    '<key>WorkingDirectory</key><string>' + xml(root) + '</string>' +
    // The daemon finds claude, cursor-agent, opencode and codex on PATH, so it needs the user's.
    '<key>EnvironmentVariables</key><dict><key>PATH</key><string>' + xml([...new Set([path.dirname(process.execPath), ...(process.env.PATH || "/usr/bin:/bin").split(path.delimiter)].filter(dir => dir && !dir.includes("node_modules") && fs.existsSync(dir)))].join(path.delimiter)) + '</string><key>PASEO_HOME</key><string>' + xml(home) + '</string></dict>' +
    '<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>10</integer><key>Umask</key><integer>63</integer>' +
    '<key>StandardOutPath</key><string>' + xml(log) + '</string><key>StandardErrorPath</key><string>' + xml(log) + '</string></dict></plist>';
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (existing !== null) {
    try { run("/bin/launchctl", ["bootout", `gui/${uid}/${label}`], { timeout: 20_000 }); } catch { /* It may already be unloaded. */ }
  }
  fs.writeFileSync(`${file}.next`, plist, { mode: 0o600 });
  fs.renameSync(`${file}.next`, file);
  bootstrap(file);
}

async function main() {
  if (process.platform !== "darwin" && process.platform !== "linux") throw new Error("Managed Paseo supports macOS and Linux (including WSL2). Run `paseo daemon start --foreground` yourself and set DEVHUB_PASEO_URL.");
  const saved = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, "utf8")) : undefined;
  if (!saved) await assertPortFree();
  const installed = installedVersion();
  let version = installed || pinned.cli;
  if (updateRequested) {
    const npm = which("aikido-npm");
    if (!npm) throw new Error("Safe-Chain is required to update Paseo.");
    // Ask the same protected registry that will install it; published releases can still be held for minimum age.
    // Safe-Chain prints a notice on stdout after the JSON version. One quoted version is the release.
    const versions = run(npm, ["view", "@getpaseo/cli", "version", "--json"], { timeout: 30_000 }).split(/\r?\n/).map((line) => line.trim()).filter((line) => /^"\d+\.\d+\.\d+"$/.test(line));
    if (versions.length !== 1) throw new Error("Paseo did not publish an installable stable version.");
    const latest = JSON.parse(versions[0]);
    const newer = !installed || latest.localeCompare(installed, "en", { numeric: true }) > 0;
    if (newer) version = latest;
  }
  const configFile = path.join(home, "config.json");
  const previousConfig = fs.existsSync(configFile) ? fs.readFileSync(configFile) : null;
  const transaction = installed !== version ? installCli(version) : undefined;
  try {
  const require = createRequire(path.join(root, "node_modules", "@getpaseo", "server", "package.json"));
  const { hashSync } = require("bcryptjs");
  const password = configuredPassword();
  installDevHubBootstrap(root);
  writeConfig(hashSync(password, 12), version);
  const cli = path.join(root, "node_modules", "@getpaseo", "cli", "bin", "paseo");
  register([process.execPath, "--disable-warning=DEP0040", ...paseoDaemonArgs(cli, home, version)]);
  await waitForHealth();
  fs.mkdirSync(config, { recursive: true, mode: 0o700 });
  fs.writeFileSync(`${manifest}.next`, JSON.stringify({ ...saved, root, home, version, url: `ws://127.0.0.1:${port}/ws`, web: `http://127.0.0.1:${port}` }), { mode: 0o600 });
  fs.renameSync(`${manifest}.next`, manifest);
  } catch (error) {
    if (transaction) {
      transaction.rollback();
      if (previousConfig) fs.writeFileSync(configFile, previousConfig, { mode: 0o600 });
      if (installed) {
        const cli = path.join(root, "node_modules", "@getpaseo", "cli", "bin", "paseo");
        register([process.execPath, "--disable-warning=DEP0040", ...paseoDaemonArgs(cli, home, installed)]);
        await waitForHealth();
      }
    }
    throw error;
  }
  transaction?.commit();
  console.log(`Managed Paseo ${version} is running on 127.0.0.1:${port}.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Paseo setup failed."); process.exitCode = 1; });
