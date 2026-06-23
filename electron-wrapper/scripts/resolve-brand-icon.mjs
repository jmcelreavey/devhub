#!/usr/bin/env node
/**
 * Resolve the packaged-app icon before electron-builder runs.
 *
 * Writes `electron-wrapper/build/icon.png` (git-ignored) from whichever icon is active:
 *   - `dashboard/public/plugin-electron-icon.png` if a branding plugin contributed one;
 *   - otherwise the default `dashboard/public/icon-512.png`.
 *
 * electron-builder's `mac.icon` / `linux.icon` point at the resolved file, so packaging
 * picks up a plugin whitelabel without any conditional config.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const wrapperRoot = path.resolve(here, "..");
const publicDir = path.resolve(wrapperRoot, "..", "dashboard", "public");
const branded = path.join(publicDir, "plugin-electron-icon.png");
const fallback = path.join(publicDir, "icon-512.png");

const src = fs.existsSync(branded) ? branded : fallback;
if (!fs.existsSync(src)) {
  console.warn(`[resolve-brand-icon] no icon found at ${src}; skipping`);
  process.exit(0);
}

const buildDir = path.join(wrapperRoot, "build");
fs.mkdirSync(buildDir, { recursive: true });
const dest = path.join(buildDir, "icon.png");
fs.copyFileSync(src, dest);
console.log(`[resolve-brand-icon] ${path.basename(src)} -> build/icon.png`);
