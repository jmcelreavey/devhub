/**
 * Server-side "open in Cursor" — resolves the `cursor` CLI once and spawns it
 * detached. Shared by the repos open route and the capability lab workspace
 * route so the PATH-resolution logic lives in exactly one place.
 */

import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { EXTRA_PATH_SEGMENTS } from "@/lib/process-env";

let cachedCursorBin: string | null | undefined;

export function resolveCursorBin(): string | null {
  if (cachedCursorBin !== undefined) return cachedCursorBin;
  const shellBin = process.env.SHELL || "/bin/sh";
  try {
    const resolved = execSync(`${shellBin} -l -c 'which cursor'`, {
      encoding: "utf8",
      timeout: 5_000,
    }).trim();
    if (resolved && fs.existsSync(resolved)) {
      cachedCursorBin = resolved;
      return cachedCursorBin;
    }
  } catch {
    /* fall through to known install dirs */
  }
  for (const dir of EXTRA_PATH_SEGMENTS) {
    const candidate = path.join(dir, "cursor");
    if (fs.existsSync(candidate)) {
      cachedCursorBin = candidate;
      return cachedCursorBin;
    }
  }
  cachedCursorBin = null;
  return null;
}

/**
 * Open an absolute path (file or folder) in Cursor. Returns an error string
 * when the CLI is missing or the path doesn't exist; null on success.
 */
export function openPathInCursor(absolutePath: string): string | null {
  if (!fs.existsSync(absolutePath)) return "Path not found";
  const bin = resolveCursorBin();
  if (!bin) return "Cursor CLI not found on PATH";
  const child = spawn(bin, [absolutePath], { detached: true, stdio: "ignore" });
  child.unref();
  return null;
}
