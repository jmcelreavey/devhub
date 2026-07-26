#!/usr/bin/env node
/**
 * Can this machine build the desktop app, and is the staged tree complete?
 *
 * Written because the alternative — discovering a missing toolchain twenty
 * minutes into a Rust build, or a missing native binding at app launch — is a
 * bad way to spend an afternoon. Every check reports what to do about it,
 * because a diagnostic that only tells you something is wrong is half a tool.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import os from "node:os";
import {
  binariesDir,
  desktopDir,
  repoRoot,
  resourcesDir,
  serverDir,
  servicesDir,
  hostTargetTriple,
} from "./staging-paths.mjs";

const checks = [];

function check(name, ok, detail, fix) {
  checks.push({ name, ok, detail, fix });
}

function version(bin, args) {
  try {
    return execFileSync(bin, args, { encoding: "utf8", timeout: 8000 }).split("\n")[0].trim();
  } catch {
    return null;
  }
}

const cargo = version("cargo", ["--version"]);
check("cargo", Boolean(cargo), cargo ?? "not found", "Install Rust: https://rustup.rs");

const rustc = version("rustc", ["--version"]);
check("rustc", Boolean(rustc), rustc ?? "not found", "Install Rust: https://rustup.rs");

const tauriCli = version("cargo", ["tauri", "--version"]);
check(
  "tauri CLI",
  Boolean(tauriCli),
  tauriCli ?? "not found",
  'Install it: cargo install tauri-cli --version "^2" --locked',
);

if (process.platform === "darwin") {
  const xcode = version("xcode-select", ["-p"]);
  check("Xcode command line tools", Boolean(xcode), xcode ?? "not found", "xcode-select --install");
}

const triple = hostTargetTriple();
const nodeBin = path.join(binariesDir, `node-${triple}${process.platform === "win32" ? ".exe" : ""}`);
check(
  "staged node runtime",
  fs.existsSync(nodeBin),
  fs.existsSync(nodeBin) ? version(nodeBin, ["--version"]) ?? "present" : `missing ${path.basename(nodeBin)}`,
  "npm run desktop:stage",
);

const staged = [
  ["dashboard server", path.join(serverDir, "server.js")],
  ["client assets", path.join(serverDir, ".next", "static")],
  ["sidecar supervisor", path.join(servicesDir, "supervisor.mjs")],
  ["terminal server", path.join(servicesDir, "terminal-pty-server.cjs")],
  ["node-pty binding", path.join(servicesDir, "node_modules", "node-pty", "build", "Release")],
  ["packaged resources", path.join(resourcesDir, "MANIFEST.json")],
];
for (const [label, target] of staged) {
  check(`staged: ${label}`, fs.existsSync(target), path.relative(repoRoot, target), "npm run desktop:stage");
}

const dashboardModules = path.join(repoRoot, "dashboard", "node_modules");
check(
  "dashboard dependencies",
  fs.existsSync(dashboardModules),
  fs.existsSync(dashboardModules) ? "installed" : "missing",
  "npm install",
);

check(
  "host target",
  true,
  `${os.platform()}/${os.arch()} → ${triple}`,
  undefined,
);

let failed = 0;
for (const { name, ok, detail, fix } of checks) {
  if (!ok) failed += 1;
  const mark = ok ? "ok  " : "FAIL";
  process.stdout.write(`${mark}  ${name}${detail ? ` — ${detail}` : ""}\n`);
  if (!ok && fix) process.stdout.write(`      fix: ${fix}\n`);
}

process.stdout.write(
  failed === 0
    ? "\nReady to build the desktop app.\n"
    : `\n${failed} check${failed === 1 ? "" : "s"} failed. Fix the above, then re-run.\n`,
);
process.exit(failed === 0 ? 0 : 1);

void desktopDir;
