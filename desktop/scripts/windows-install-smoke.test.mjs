import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = path.resolve(desktopDir, "..");
const script = fs.readFileSync(path.join(desktopDir, "scripts", "windows-install-smoke.ps1"), "utf8");
const workflow = fs.readFileSync(path.join(repoDir, ".github", "workflows", "release-desktop.yml"), "utf8");
const windowsConfig = JSON.parse(fs.readFileSync(path.join(desktopDir, "src-tauri", "tauri.windows.conf.json"), "utf8"));
const cargo = fs.readFileSync(path.join(desktopDir, "src-tauri", "Cargo.toml"), "utf8");

test("the smoke script expects the exe and WSL payload files the installer actually bundles", () => {
  // Tauri names the installed exe after the Cargo package unless mainBinaryName is set.
  const pkg = cargo.match(/^name = "([^"]+)"/m)?.[1];
  assert.ok(pkg);
  assert.equal(JSON.parse(fs.readFileSync(path.join(desktopDir, "src-tauri", "tauri.conf.json"), "utf8")).mainBinaryName, undefined);
  assert.ok(script.includes(`$MainExe = '${pkg}.exe'`), "main exe name must follow the Cargo package name");

  const bundled = Object.values(windowsConfig.bundle.resources).filter(Boolean);
  for (const dest of bundled) {
    assert.ok(script.includes(dest.replaceAll("/", "\\")), `smoke script must check bundled resource ${dest}`);
  }
});

test("the smoke script installs per-user into a throwaway directory and never needs elevation", () => {
  assert.equal(windowsConfig.bundle.windows.nsis.installMode, "currentUser");
  assert.match(script, /"\/S \/D=\$installDir"/);
  assert.match(script, /HKCU:/);
  assert.doesNotMatch(script, /-Verb\s+RunAs|HKLM:/i);
  // The start check must be hermetic: temp app data, no link to a checkout or distro.
  assert.match(script, /DEVHUB_APP_DATA/);
  for (const name of ["DEVHUB_WSL_DISTRO", "DEVHUB_WSL_REPO", "DEVHUB_DEV_SERVER_URL"]) assert.ok(script.includes(name));
  // Its pre-install hook can stop a real DevHub's WSL supervisor, so it is CI-only by default.
  assert.match(script, /GITHUB_ACTIONS[\s\S]*-Force/);
});

test("the start check waits for the line the shell really logs", () => {
  const lib = fs.readFileSync(path.join(desktopDir, "src-tauri", "src", "lib.rs"), "utf8");
  assert.match(lib, /\[startup\] DevHub \{\} starting/);
  assert.ok(script.includes("\\[startup\\] DevHub (\\S+) starting"));
  assert.ok(script.includes("logs\\shell.log"));
});

test("the workflow smokes the artifact the windows job built, without rebuilding or gating publish", () => {
  const job = workflow.match(/\n  windows-smoke:\n([\s\S]*?)\n  publish:\n/)?.[1] ?? "";
  assert.ok(job, "windows-smoke job must exist");
  assert.match(job, /needs: windows\n/);
  assert.match(job, /runs-on: windows-latest/);
  assert.match(job, /name: devhub-x86_64-pc-windows-msvc/);
  assert.match(job, /timeout-minutes:/);
  // Reuse, not a second build.
  assert.doesNotMatch(job, /tauri-action|cargo |rust-toolchain|npm (ci|install)|setup-node/);
  const publishNeeds = workflow.match(/\n  publish:\n[\s\S]*?needs: (\[[^\]]*\])/)?.[1] ?? "";
  assert.doesNotMatch(publishNeeds, /windows-smoke/);
});
