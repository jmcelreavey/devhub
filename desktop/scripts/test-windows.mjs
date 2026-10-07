#!/usr/bin/env node
/**
 * Tauri embeds Common Controls v6 in the app, but not Cargo's unit-test
 * executables. Without it, the Windows loader exits before any test runs.
 * https://github.com/tauri-apps/tauri/issues/13419
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

if (process.platform !== "win32") throw new Error("Run this check on Windows.");

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const cargoDir = path.resolve(scriptsDir, "../src-tauri");
const sdkBin = path.join(
  process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
  "Windows Kits", "10", "bin",
);
const mt = fs.readdirSync(sdkBin)
  .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  .map((version) => path.join(sdkBin, version, "x64", "mt.exe"))
  .find((candidate) => fs.existsSync(candidate));
if (!mt) throw new Error("Windows SDK manifest tool (mt.exe) is missing.");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: cargoDir,
    encoding: "utf8",
    stdio: "inherit",
    timeout: 15 * 60 * 1000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.argv[2] === "--run") {
  const executable = process.argv[3];
  if (!executable) throw new Error("Cargo supplied no test executable.");
  run(mt, [
    "-manifest", path.join(scriptsDir, "windows-test-manifest.xml"),
    `-outputresource:${executable};#1`,
  ]);
  run(executable, process.argv.slice(4));
} else {
  // Apply the manifest after Cargo's final link, preserving its test environment.
  // A per-command runner leaves ordinary app launches unchanged.
  const runner = [process.execPath, fileURLToPath(import.meta.url), "--run"];
  run("cargo", [
    "test", "--config",
    `target.x86_64-pc-windows-msvc.runner=${JSON.stringify(runner)}`,
  ]);
}
