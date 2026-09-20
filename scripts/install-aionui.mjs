#!/usr/bin/env node
/** Pinned, machine-local companion. launchd owns processes; no PID/port killing. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const updateRequested = process.argv.includes("--update");
const pinnedRelease = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "aionui-release.json"), "utf8"));
let uiVersion = pinnedRelease.ui, coreVersion = pinnedRelease.core, expectedCommit = pinnedRelease.uiCommit;
let archiveSha = pinnedRelease.coreArchiveSha;
const root = path.join(os.homedir(), ".local", "share", "devhub", "aionui");
let release = path.join(root, uiVersion);
const data = path.join(root, "data");
const config = path.join(os.homedir(), ".config", "devhub");
const manifest = path.join(config, "aionui-managed.json");
const credentials = path.join(config, "aionui-bootstrap.json");
const transaction = path.join(root, ".install-state.json");
const corePort = 25819, webPort = 25818;
const uid = process.getuid?.();
function configuredPassword() {
  if (process.env.OPENCHAMBER_UI_PASSWORD?.trim()) return process.env.OPENCHAMBER_UI_PASSWORD.trim();
  const file = path.join(import.meta.dirname, "..", "dashboard", ".env.local");
  const match = fs.existsSync(file) ? fs.readFileSync(file, "utf8").match(/^OPENCHAMBER_UI_PASSWORD=(.*)$/m) : null;
  if (!match) throw new Error("Set OPENCHAMBER_UI_PASSWORD in dashboard/.env.local before setting up AionUi.");
  const value = match[1].trim();
  const password = value.startsWith('"') && value.endsWith('"') ? JSON.parse(value) : value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1) : value;
  if (!password) throw new Error("OPENCHAMBER_UI_PASSWORD cannot be empty.");
  return password;
}
function prepareLogin(core) {
  const password = configuredPassword();
  run(core, ["--data-dir",data,"user","set-password","--password-stdin"], { input: password + "\n", timeout: 15_000 });
  fs.writeFileSync(credentials, JSON.stringify({ origin:"http://127.0.0.1:"+webPort, username:"admin", password }), { mode: 0o600 });
}
function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", timeout: 600_000, maxBuffer: 20_000_000, ...options });
}
function pause(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function bootstrap(file) {
  let error;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { run("/bin/launchctl", ["bootstrap", "gui/" + uid, file], { timeout: 20_000 }); return; }
    catch (caught) { error = caught; pause(250 * (attempt + 1)); }
  }
  throw error;
}
function xml(s) { return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
async function free(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error("AionUi's managed port is occupied. Connect the existing workspace or free port " + port + ".")));
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}
async function waitFor(url) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).status === 401) return; } catch { /* Startup is bounded below. */ }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error("AionUi did not start. Inspect its logs in " + root);
}
function register(label, args, cwd, replace = false) {
  const file = path.join(os.homedir(), "Library", "LaunchAgents", label + ".plist");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const plist = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>' +
    '<key>Label</key><string>' + label + '</string><key>ProgramArguments</key><array>' + args.map(a => '<string>' + xml(a) + '</string>').join('') + '</array>' +
    '<key>WorkingDirectory</key><string>' + xml(cwd) + '</string><key>EnvironmentVariables</key><dict><key>PATH</key><string>' + xml(process.env.PATH || "/usr/bin:/bin") + '</string></dict>' +
    '<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>10</integer><key>Umask</key><integer>63</integer>' +
    '<key>StandardOutPath</key><string>' + xml(path.join(root,label+".log")) + '</string><key>StandardErrorPath</key><string>' + xml(path.join(root,label+".log")) + '</string></dict></plist>';
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, "utf8");
    if (existing !== plist && !replace) throw new Error("A different launch definition already exists: " + label);
    if (existing !== plist) {
      try { run("/bin/launchctl", ["bootout", "gui/" + uid + "/" + label], { timeout: 20_000 }); } catch { /* It may already be unloaded. */ }
      const next = file + ".next";
      fs.writeFileSync(next, plist, { mode: 0o600 });
      fs.renameSync(next, file);
    } else {
      try { run("/bin/launchctl", ["print", "gui/" + uid + "/" + label], { timeout: 5000 }); return; } catch { /* Restore this install's unloaded job. */ }
    }
  } else fs.writeFileSync(file, plist, { flag: "wx", mode: 0o600 });
  bootstrap(file);
}
async function main() {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Managed installation currently supports Apple silicon. Connect an authenticated AionUi WebUI on this platform.");
  const saved = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest,"utf8")) : undefined;
  if (saved && !saved.ui && saved.uiCommit === expectedCommit && saved.root === root) {
    const nextManifest = manifest + ".next";
    saved.ui = pinnedRelease.ui;
    fs.writeFileSync(nextManifest, JSON.stringify(saved), { mode: 0o600 });
    fs.renameSync(nextManifest, manifest);
  }
  if (saved && !updateRequested) {
    if (saved.uiCommit !== expectedCommit || saved.root !== root) throw new Error("The installed companion has a different version. Keep its existing history and reconnect manually.");
    prepareLogin(path.join(saved.root, saved.ui ?? pinnedRelease.ui, "aioncore"));
    for (const label of ["devhub.aionui.core", "devhub.aionui.web"]) run("/bin/launchctl", ["kickstart", "-k", "gui/" + uid + "/" + label], { timeout: 20_000 });
    await waitFor(saved.origin + "/api/system/current-user");
    console.log("Managed AionUi is ready.");
    return;
  }
  if (updateRequested) {
    if (!saved || saved.root !== root) throw new Error("Set up the managed AionUi workspace before updating it.");
    const [uiResponse, coreResponse] = await Promise.all([
      fetch("https://api.github.com/repos/iOfficeAI/AionUi/releases/latest", { headers: { Accept: "application/vnd.github+json", "User-Agent": "DevHub" }, signal: AbortSignal.timeout(15_000) }),
      fetch("https://api.github.com/repos/iOfficeAI/AionCore/releases/latest", { headers: { Accept: "application/vnd.github+json", "User-Agent": "DevHub" }, signal: AbortSignal.timeout(15_000) }),
    ]);
    if (!uiResponse.ok || !coreResponse.ok) throw new Error("Could not check the latest AionUi release.");
    const ui = await uiResponse.json(), core = await coreResponse.json();
    uiVersion = String(ui.tag_name || "").replace(/^v/, ""); coreVersion = String(core.tag_name || "").replace(/^v/, "");
    if (!/^\d+\.\d+\.\d+$/.test(uiVersion) || !/^\d+\.\d+\.\d+$/.test(coreVersion)) throw new Error("The latest release metadata is invalid.");
    if ((saved.ui ?? pinnedRelease.ui) === uiVersion && saved.core === coreVersion) { console.log("Managed AionUi is already current."); return; }
    const assetName = `aioncore-v${coreVersion}-aarch64-apple-darwin.tar.gz`;
    const asset = core.assets?.find(item => item.name === assetName);
    if (!asset || !Number.isSafeInteger(asset.id) || !String(asset.digest || "").startsWith("sha256:")) throw new Error("The latest AionCore release has no verified Apple silicon asset.");
    archiveSha = String(asset.digest).slice(7); release = path.join(root, uiVersion); expectedCommit = "";
  }
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.mkdirSync(config, { recursive: true, mode: 0o700 });
  const lock = path.join(root, ".install-lock");
  if (fs.existsSync(lock)) {
    const owner = Number(fs.readFileSync(lock, "utf8"));
    if (!Number.isSafeInteger(owner) || owner < 1) throw new Error("The installation lock needs inspection: " + lock);
    try { process.kill(owner, 0); throw new Error("An AionUi installation is already running."); }
    catch (error) { if (error.code !== "ESRCH") throw error; fs.rmSync(lock); }
  }
  fs.writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });
  let updateBackup;
  const priorPlists = new Map();
  try {
    if (fs.existsSync(transaction)) {
      const prior = JSON.parse(fs.readFileSync(transaction, "utf8"));
      if (prior.uiVersion !== uiVersion || prior.root !== root) throw new Error("An unknown partial installation needs inspection.");
    } else {
      if (!saved) { await free(corePort); await free(webPort); }
      if (!saved && fs.existsSync(data)) throw new Error("An existing AionUi history store needs manual attachment; setup will not reset its credentials.");
      fs.writeFileSync(transaction, JSON.stringify({ root, uiVersion }), { flag: "wx", mode: 0o600 });
    }
    const bun = run("/usr/bin/which", ["bun"], { timeout: 5000 }).trim();
    if (!fs.existsSync(path.join(release, ".git"))) {
      if (fs.existsSync(release)) throw new Error("An incomplete installation exists at " + release + ". Inspect it before retrying.");
      run("git", ["clone", "--depth=1", "--branch=v" + uiVersion, "https://github.com/iOfficeAI/AionUi.git", release]);
    }
    const commit = run("git", ["rev-parse", "HEAD"], { cwd: release }).trim();
    if (expectedCommit && commit !== expectedCommit) throw new Error("AionUi source does not match the pinned release.");
    const archive = path.join(root, `aioncore-v${coreVersion}.tar.gz`);
    let response = await fetch(`https://github.com/iOfficeAI/AionCore/releases/download/v${coreVersion}/aioncore-v${coreVersion}-aarch64-apple-darwin.tar.gz`, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) {
      const releaseResponse = await fetch(`https://api.github.com/repos/iOfficeAI/AionCore/releases/tags/v${coreVersion}`, { signal: AbortSignal.timeout(15_000) });
      if (!releaseResponse.ok) throw new Error("Could not locate the pinned AionCore release.");
      const releaseInfo = await releaseResponse.json();
      const asset = releaseInfo.assets.find(a => a.name === `aioncore-v${coreVersion}-aarch64-apple-darwin.tar.gz`);
      if (!asset || !Number.isSafeInteger(asset.id)) throw new Error("The pinned AionCore asset is missing.");
      response = await fetch("https://api.github.com/repos/iOfficeAI/AionCore/releases/assets/" + asset.id, { headers: { Accept: "application/octet-stream" }, signal: AbortSignal.timeout(120_000) });
    }
    if (!response.ok) throw new Error("Could not download the pinned AionCore release.");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== archiveSha) throw new Error("AionCore checksum verification failed.");
    fs.writeFileSync(archive, bytes, { mode: 0o600 });
    run("/usr/bin/tar", ["-xzf", archive, "-C", release]);
    fs.rmSync(archive);
    run(bun, ["install", "--frozen-lockfile"], { cwd: release });
    run(process.execPath, [path.join(import.meta.dirname, "aionui-apply-source-patches.mjs"), release], { timeout: 15_000 });
    run(bun, ["run", "package"], { cwd: release });
    // AionCore enforces CSRF; open-source WebUI stubs the header. Patch browser HTTP clients.
    run(process.execPath, [path.join(import.meta.dirname, "aionui-apply-web-patches.mjs"), release], { timeout: 15_000 });
    const core = path.join(release,"aioncore");
    fs.chmodSync(core,0o700);
    // Reuse the upstream HTTP/WebSocket host while retaining normal authentication.
    const host = path.join(release,"devhub-host.ts");
    fs.writeFileSync(host, [
      "import { startWebHost } from './packages/web-host/src/index.ts';",
      "const handle = await startWebHost(" + JSON.stringify({
        app: { version: uiVersion, isPackaged: false, resourcesPath: release, userDataPath: data },
        staticDir: path.join(release,"out/renderer"), dataDir: data,
        backend: { kind: "useExistingBackend", port: corePort }, port: webPort, allowRemote: false,
      }) + ");",
      "for (const signal of ['SIGTERM','SIGINT']) process.on(signal,async()=>{await handle.stop();process.exit(0);});",
    ].join("\n"), { mode: 0o600 });
    if (saved && updateRequested) {
      // Stop both readers before copying SQLite, then retain a recovery snapshot.
      for (const label of ["devhub.aionui.web", "devhub.aionui.core"]) {
        const plist = path.join(os.homedir(), "Library", "LaunchAgents", label + ".plist");
        priorPlists.set(label, fs.readFileSync(plist, "utf8"));
        try { run("/bin/launchctl", ["bootout", "gui/" + uid + "/" + label], { timeout: 20_000 }); } catch { /* Already stopped. */ }
      }
      updateBackup = path.join(root, "backups", `before-${uiVersion}-${Date.now()}`);
      fs.mkdirSync(path.dirname(updateBackup), { recursive: true, mode: 0o700 });
      fs.cpSync(data, updateBackup, { recursive: true, errorOnExist: true, force: false });
      console.log("Conversation backup saved before update: " + updateBackup);
    }
    register("devhub.aionui.core",[core,"--host","127.0.0.1","--port",String(corePort),"--data-dir",data,"--identity-mode","webui","--app-version",uiVersion],release,Boolean(saved));
    await waitFor("http://127.0.0.1:" + corePort + "/api/system/current-user");
    if (!fs.existsSync(credentials) || updateRequested) {
      prepareLogin(core);
      run("/bin/launchctl", ["kickstart", "-k", "gui/" + uid + "/devhub.aionui.core"], { timeout: 20_000 });
      await waitFor("http://127.0.0.1:" + corePort + "/api/system/current-user");
    }
    register("devhub.aionui.web",[bun,"run",host],release,Boolean(saved));
    await waitFor("http://127.0.0.1:" + webPort + "/api/system/current-user");
    const nextManifest = manifest + ".next";
    fs.writeFileSync(nextManifest,JSON.stringify({root,ui:uiVersion,uiCommit:commit,core:coreVersion,origin:"http://127.0.0.1:"+webPort}),{mode:0o600});
    fs.renameSync(nextManifest,manifest);
    fs.rmSync(transaction, { force: true });
    console.log("Managed AionUi installed.");
  } catch (error) {
    if (updateBackup && priorPlists.size === 2) {
      for (const label of priorPlists.keys()) {
        try { run("/bin/launchctl", ["bootout", "gui/" + uid + "/" + label], { timeout: 20_000 }); } catch { /* Best-effort rollback. */ }
      }
      const failedData = `${data}.failed-${Date.now()}`;
      fs.renameSync(data, failedData);
      fs.cpSync(updateBackup, data, { recursive: true, errorOnExist: true, force: false });
      for (const [label, contents] of priorPlists) {
        const plist = path.join(os.homedir(), "Library", "LaunchAgents", label + ".plist");
        fs.writeFileSync(plist, contents, { mode: 0o600 });
        bootstrap(plist);
      }
      console.error("The update was rolled back. Failed data was retained at " + failedData);
    }
    throw error;
  } finally { fs.rmSync(lock,{force:true}); }
}
main().catch(error=>{ console.error(error instanceof Error ? error.message : "AionUi setup failed.");process.exitCode=1; });
