// Enforces tooling that *registered plugins* require — without forcing it on the core
// template. Runs in `preinstall`, so it gates `npm install` / `npm ci`.
//
// A plugin declares its needs in `devhub-plugin.json`:
//   "requires": { "commands": [ { "command": "safe-chain", "install": "npm i -g …" } ] }
//
// We read the machine-local registry (~/.config/devhub/plugins.json), and for each
// enabled plugin check that every required command is on PATH. A fresh fork with no
// plugins registered hits nothing here — the gate only bites when a plugin opts in.
//
// Plain ESM, no dependencies: preinstall runs before node_modules exists. Tolerant by
// design — a missing/broken registry or manifest is skipped, never fatal.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();

function expandHome(p) {
  if (p === "~") return HOME;
  if (p.startsWith("~/")) return path.join(HOME, p.slice(2));
  return path.resolve(p);
}

/** Cross-platform PATH lookup (no shell), honouring Windows PATHEXT. */
function isOnPath(command) {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const exts = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
    : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        // try next
      }
    }
  }
  return false;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function enabledPluginDirs() {
  const registry = readJson(path.join(HOME, ".config", "devhub", "plugins.json"));
  const entries = Array.isArray(registry?.plugins) ? registry.plugins : [];
  const dirs = [];
  for (const entry of entries) {
    if (entry?.enabled === false) continue;
    if (typeof entry?.path !== "string" || !entry.path.trim()) continue;
    const dir = expandHome(entry.path.trim());
    if (fs.existsSync(dir)) dirs.push(dir);
  }
  return dirs;
}

const missing = []; // { plugin, command, install }
for (const dir of enabledPluginDirs()) {
  const manifest = readJson(path.join(dir, "devhub-plugin.json"));
  const commands = manifest?.requires?.commands;
  if (!Array.isArray(commands)) continue;
  for (const req of commands) {
    if (!req || typeof req.command !== "string") continue;
    if (!isOnPath(req.command)) {
      missing.push({ plugin: manifest?.name ?? path.basename(dir), command: req.command, install: req.install });
    }
  }
}

if (missing.length > 0) {
  let msg = "\n✖ Required tooling for registered plugins is missing:\n";
  for (const m of missing) {
    msg += `  • ${m.command} (needed by plugin "${m.plugin}")\n`;
    if (m.install) msg += `      install: ${m.install}\n`;
  }
  msg += "\nInstall the tools above, or disable the plugin in ~/.config/devhub/plugins.json, then retry.\n\n";
  process.stderr.write(msg);
  process.exit(1);
}
