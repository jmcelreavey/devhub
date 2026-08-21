#!/usr/bin/env node
/**
 * Stage the OS app icons the Tauri bundler ships.
 *
 * The *bundled* Dock / Finder icon is always the core DevHub bottle
 * (`dashboard/public/icon-512.png`). Plugin branding used to win this race
 * whenever `plugin-desktop-icon.png` existed, so a BI-branded machine shipped
 * a BI `.icns` and macOS's persistent Dock tile ignored every runtime reset.
 *
 * Plugin icons still exist — they land next to the bottle as `plugin.png` and
 * the shell overlays them at runtime when the in-app logo is the plugin brand.
 *
 * Icons land under `desktop/staging/icons/` (gitignored) so a plugin-branded
 * build does not dirty the committed defaults in `src-tauri/icons/`.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { dashboardDir, repoRoot, stagingDir } from "./staging-paths.mjs";

export const iconsStagingDir = path.join(stagingDir, "icons");

const PLUGIN_ICON = path.join(dashboardDir, "public", "plugin-desktop-icon.png");
const DEFAULT_ICON = path.join(dashboardDir, "public", "icon-512.png");
const PLUGIN_SIDECAR = path.join(iconsStagingDir, "plugin.png");
const MARKER = path.join(iconsStagingDir, ".source.sha256");

/** Required by tauri.conf.json `bundle.icon`. */
const REQUIRED = ["32x32.png", "128x128.png", "128x128@2x.png", "icon.icns"];

/** Platform leftovers `cargo tauri icon` emits that we do not ship. */
const PRUNE_DIRS = ["android", "ios"];
const PRUNE_PREFIXES = ["Square", "StoreLogo"];

/**
 * The file `cargo tauri icon` turns into the bundled `.icns`.
 * Always the bottle — plugin branding is a runtime overlay, not the app tile.
 *
 * @returns {{ source: string, kind: "default" }}
 */
export function resolveDesktopIconSource(
  _pluginIcon = PLUGIN_ICON,
  defaultIcon = DEFAULT_ICON,
) {
  if (!fs.existsSync(defaultIcon)) {
    throw new Error(
      `No desktop icon source. Expected the core bottle at ${defaultIcon}.`,
    );
  }
  return { source: defaultIcon, kind: "default" };
}

/**
 * Copy (or clear) the plugin PNG the running shell overlays on the Dock.
 *
 * @returns {"plugin" | "none"}
 */
export function stagePluginSidecar(
  pluginIcon = PLUGIN_ICON,
  dest = PLUGIN_SIDECAR,
  fallback = DEFAULT_ICON,
) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(pluginIcon)) {
    fs.copyFileSync(pluginIcon, dest);
    return "plugin";
  }
  // Always ship a sidecar so tauri.conf.json can list it. No plugin → bottle.
  if (fs.existsSync(fallback)) {
    fs.copyFileSync(fallback, dest);
    return "none";
  }
  fs.rmSync(dest, { force: true });
  return "none";
}

function digestFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function pruneJunk(outDir) {
  for (const dir of PRUNE_DIRS) {
    fs.rmSync(path.join(outDir, dir), { recursive: true, force: true });
  }
  for (const name of fs.readdirSync(outDir)) {
    if (PRUNE_PREFIXES.some((p) => name.startsWith(p))) {
      fs.rmSync(path.join(outDir, name), { force: true });
    }
  }
}

function assertRequired(outDir) {
  const missing = REQUIRED.filter((name) => !fs.existsSync(path.join(outDir, name)));
  if (missing.length > 0) {
    throw new Error(`Staged icons incomplete — missing ${missing.join(", ")}`);
  }
}

/**
 * @param {{ force?: boolean }} [opts]
 */
export function stageIcons({ force = false } = {}) {
  const { source, kind } = resolveDesktopIconSource();
  const digest = digestFile(source);
  const sidecar = stagePluginSidecar();
  const markerValue = `${kind}:${digest}:sidecar=${sidecar}`;

  if (
    !force &&
    fs.existsSync(MARKER) &&
    fs.readFileSync(MARKER, "utf8").trim() === markerValue &&
    REQUIRED.every((name) => fs.existsSync(path.join(iconsStagingDir, name))) &&
    (sidecar === "none" || fs.existsSync(PLUGIN_SIDECAR))
  ) {
    process.stdout.write(`[stage-icons] cached (${kind}, sidecar=${sidecar})\n`);
    return { kind, source, sidecar, cached: true };
  }

  fs.mkdirSync(iconsStagingDir, { recursive: true });

  const result = spawnSync(
    "cargo",
    ["tauri", "icon", source, "--output", iconsStagingDir],
    { stdio: "inherit", cwd: repoRoot, env: process.env },
  );
  if (result.status !== 0) {
    throw new Error(
      `cargo tauri icon failed (exit ${result.status ?? "null"}). Is tauri-cli installed?`,
    );
  }

  pruneJunk(iconsStagingDir);
  // `cargo tauri icon` wiped the dir; restore the sidecar it is not responsible for.
  const sidecarAfter = stagePluginSidecar();
  assertRequired(iconsStagingDir);
  fs.writeFileSync(MARKER, `${kind}:${digest}:sidecar=${sidecarAfter}\n`, "utf8");

  process.stdout.write(
    `[stage-icons] staged from ${kind} (${path.relative(repoRoot, source)}), sidecar=${sidecarAfter}\n`,
  );
  return { kind, source, sidecar: sidecarAfter, cached: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    stageIcons({ force: process.argv.includes("--force") });
  } catch (err) {
    process.stderr.write(`[stage-icons] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
