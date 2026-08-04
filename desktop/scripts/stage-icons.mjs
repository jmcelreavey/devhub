#!/usr/bin/env node
/**
 * Stage the OS app icons the Tauri bundler ships.
 *
 * Plugin branding materialises `dashboard/public/plugin-desktop-icon.png` when a
 * branding plugin (e.g. devhub-bi) is enabled. Without one, we fall back to the
 * core DevHub bottle at `dashboard/public/icon-512.png`.
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
const MARKER = path.join(iconsStagingDir, ".source.sha256");

/** Required by tauri.conf.json `bundle.icon`. */
const REQUIRED = ["32x32.png", "128x128.png", "128x128@2x.png", "icon.icns"];

/** Platform leftovers `cargo tauri icon` emits that we do not ship. */
const PRUNE_DIRS = ["android", "ios"];
const PRUNE_PREFIXES = ["Square", "StoreLogo"];

/**
 * @returns {{ source: string, kind: "plugin" | "default" }}
 */
export function resolveDesktopIconSource(
  pluginIcon = PLUGIN_ICON,
  defaultIcon = DEFAULT_ICON,
) {
  if (fs.existsSync(pluginIcon)) {
    return { source: pluginIcon, kind: "plugin" };
  }
  if (!fs.existsSync(defaultIcon)) {
    throw new Error(
      `No desktop icon source. Expected plugin icon at ${pluginIcon} or default at ${defaultIcon}.`,
    );
  }
  return { source: defaultIcon, kind: "default" };
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
  const markerValue = `${kind}:${digest}`;

  if (
    !force &&
    fs.existsSync(MARKER) &&
    fs.readFileSync(MARKER, "utf8").trim() === markerValue &&
    REQUIRED.every((name) => fs.existsSync(path.join(iconsStagingDir, name)))
  ) {
    process.stdout.write(`[stage-icons] cached (${kind})\n`);
    return { kind, source, cached: true };
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
  assertRequired(iconsStagingDir);
  fs.writeFileSync(MARKER, `${markerValue}\n`, "utf8");

  process.stdout.write(
    `[stage-icons] staged from ${kind} (${path.relative(repoRoot, source)})\n`,
  );
  return { kind, source, cached: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    stageIcons({ force: process.argv.includes("--force") });
  } catch (err) {
    process.stderr.write(`[stage-icons] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
