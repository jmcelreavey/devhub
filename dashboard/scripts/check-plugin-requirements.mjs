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

/**
 * Is this npm package declared in core's own package.json?
 *
 * Plugins cannot declare npm dependencies — their dashboard files are copied
 * into core and compiled against core's `node_modules`, so anything they import
 * has to be a core dependency. That coupling used to be undocumented (`pg` sat
 * in core for one plugin consumer with nothing recording why), and the way it
 * announced itself was a module-not-found at build time with no hint whose
 * import it was. Declared, it becomes one line naming the plugin and the reason.
 *
 * Checked against the manifest rather than the filesystem: this runs in
 * `preinstall`, before `node_modules` exists.
 */
function coreDependencies() {
  const pkg = readJson(path.join(process.cwd(), "package.json"));
  return new Set([
    ...Object.keys(pkg?.dependencies ?? {}),
    ...Object.keys(pkg?.devDependencies ?? {}),
  ]);
}

const missing = []; // { plugin, command, install }
const missingPackages = []; // { plugin, package, reason }
const coreDeps = coreDependencies();

for (const dir of enabledPluginDirs()) {
  const manifest = readJson(path.join(dir, "devhub-plugin.json"));
  const pluginName = manifest?.name ?? path.basename(dir);

  const commands = manifest?.requires?.commands;
  if (Array.isArray(commands)) {
    for (const req of commands) {
      if (!req || typeof req.command !== "string") continue;
      if (!isOnPath(req.command)) {
        missing.push({ plugin: pluginName, command: req.command, install: req.install });
      }
    }
  }

  const packages = manifest?.requires?.dashboardPackages;
  if (Array.isArray(packages)) {
    for (const req of packages) {
      if (!req || typeof req.package !== "string") continue;
      if (!coreDeps.has(req.package)) {
        missingPackages.push({ plugin: pluginName, package: req.package, reason: req.reason });
      }
    }
  }
}

if (missing.length > 0 || missingPackages.length > 0) {
  let msg = "\n✖ Requirements for registered plugins are not met:\n";
  for (const m of missing) {
    msg += `  • ${m.command} (command needed by plugin "${m.plugin}")\n`;
    if (m.install) msg += `      install: ${m.install}\n`;
  }
  for (const m of missingPackages) {
    msg += `  • ${m.package} (npm package needed by plugin "${m.plugin}")\n`;
    if (m.reason) msg += `      for: ${m.reason}\n`;
    msg += `      add it to dashboard/package.json — plugins compile against core's node_modules\n`;
  }
  msg += "\nResolve the above, or disable the plugin in ~/.config/devhub/plugins.json, then retry.\n\n";
  process.stderr.write(msg);
  process.exit(1);
}
