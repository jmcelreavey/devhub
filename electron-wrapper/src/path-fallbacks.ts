/**
 * Common Unix install locations searched when a binary is not on the
 * launcher's inherited PATH. GUI-launched Electron apps frequently inherit
 * a minimal PATH (e.g. just /usr/bin:/bin on macOS Finder), so we widen it.
 *
 * Mirrors dashboard/lib/process-env.ts EXTRA_PATH_SEGMENTS — kept in sync
 * by hand because the electron-wrapper tsconfig restricts rootDir to ./src
 * and the dashboard sources are not bundled into the launcher build.
 *
 * /opt/homebrew/bin  — Apple Silicon Homebrew
 * /usr/local/bin     — Intel Homebrew, common Linux distros
 * /opt/local/bin     — MacPorts
 * ~/.local/bin       — Linux user installs (pip --user, cargo, etc.)
 */
import fs from "node:fs";
import path from "node:path";

export const EXTRA_PATH_SEGMENTS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/opt/local/bin",
  `${process.env.HOME ?? ""}/.local/bin`,
].filter(Boolean);

/** Prepend `dir` to PATH if not already present. */
export function prependPath(dir: string): void {
  const existing = (process.env.PATH ?? "").split(path.delimiter);
  if (!existing.includes(dir)) {
    process.env.PATH = [dir, ...existing].join(path.delimiter);
  }
}

/** Append `dir` to PATH if not already present (keeps higher-priority dirs first). */
export function appendPath(dir: string): void {
  const existing = (process.env.PATH ?? "").split(path.delimiter);
  if (!existing.includes(dir)) {
    process.env.PATH = [...existing, dir].join(path.delimiter);
  }
}

/** All nvm-managed `node/<version>/bin` dirs, newest-installed first. Empty off nvm. */
export function nvmNodeBinDirs(): string[] {
  const base = path.join(process.env.HOME ?? "", ".nvm", "versions", "node");
  try {
    return fs
      .readdirSync(base)
      .sort()
      .reverse()
      .map((version) => path.join(base, version, "bin"));
  } catch {
    return [];
  }
}
