/**
 * Where staging puts things, and what the target triple is called.
 *
 * Every staging script and the Rust build read these from one place, because
 * "the sidecar binary is named `node-aarch64-apple-darwin`" is the kind of fact
 * that, duplicated, silently produces an app that builds fine and cannot start.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

export const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const repoRoot = path.resolve(desktopDir, "..");
export const dashboardDir = path.join(repoRoot, "dashboard");
export const tauriDir = path.join(desktopDir, "src-tauri");

/** Everything staged for the bundle. Wiped and rebuilt; never edit by hand. */
export const stagingDir = path.join(desktopDir, "staging");
/** Next standalone server + static + public. */
export const serverDir = path.join(stagingDir, "server");
/** Compiled sidecar entrypoints (supervisor, PTY). */
export const servicesDir = path.join(stagingDir, "services");
/** Generic read-only assets: skills, agents, mcp, persona, docs. */
export const resourcesDir = path.join(stagingDir, "resources");
/** Tauri external binaries — must use the target-triple suffix. */
export const binariesDir = path.join(tauriDir, "binaries");

/**
 * Rust target triple for the host.
 *
 * Tauri requires external binaries to be suffixed with the triple so it can
 * pick the right one per target. Deriving it from `process.arch`/`platform`
 * rather than shelling out to `rustc -vV` keeps staging runnable on a machine
 * that has not installed Rust yet (CI stages before it builds).
 */
export function hostTargetTriple(platform = os.platform(), arch = os.arch()) {
  const cpu = arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : null;
  if (!cpu) throw new Error(`Unsupported CPU architecture for the desktop build: ${arch}`);
  if (platform === "darwin") return `${cpu}-apple-darwin`;
  if (platform === "linux") return `${cpu}-unknown-linux-gnu`;
  if (platform === "win32") return `${cpu}-pc-windows-msvc`;
  throw new Error(`Unsupported platform for the desktop build: ${platform}`);
}

/** Node distribution naming, which does not match Rust's. */
export function nodeDistTarget(platform = os.platform(), arch = os.arch()) {
  const cpu = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : null;
  if (!cpu) throw new Error(`Unsupported CPU architecture: ${arch}`);
  if (platform === "darwin") return { os: "darwin", cpu, ext: "tar.gz" };
  if (platform === "linux") return { os: "linux", cpu, ext: "tar.xz" };
  if (platform === "win32") return { os: "win", cpu, ext: "zip" };
  throw new Error(`Unsupported platform: ${platform}`);
}
