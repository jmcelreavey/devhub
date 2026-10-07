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

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: cargoDir,
    encoding: "utf8",
    stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit",
    timeout: 15 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout ?? "";
}

const output = run("cargo", ["test", "--no-run", "--message-format=json"], true);
const executables = output.split(/\r?\n/).filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter((artifact) => artifact.reason === "compiler-artifact" && artifact.profile.test && artifact.executable)
  .map((artifact) => artifact.executable);
if (executables.length === 0) throw new Error("Cargo produced no test executables.");

for (const executable of new Set(executables)) {
  run(mt, [
    "-manifest", path.join(scriptsDir, "windows-test-manifest.xml"),
    `-outputresource:${executable};#1`,
  ]);
}
// Cargo reuses the prepared executables; failures still propagate normally.
run("cargo", ["test"]);
