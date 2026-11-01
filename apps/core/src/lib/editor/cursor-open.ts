/**
 * Server-side "open in Cursor" — resolves the `cursor` CLI once and spawns it
 * detached. Shared by the repos open route and the capability lab workspace
 * route so the PATH-resolution logic lives in exactly one place.
 */

import { localOps } from "../../local/ops/index";
import fs from "node:fs";
import path from "node:path";
import { execExternal } from "../exec-external";
import { EXTRA_PATH_SEGMENTS } from "../../local/process-env";

let cachedCursorBin: Promise<string | null> | undefined;

export function resolveCursorBin(): Promise<string | null> {
  cachedCursorBin ??= findCursorBin();
  return cachedCursorBin;
}

async function findCursorBin(): Promise<string | null> {
  const shellBin = process.env.SHELL || "/bin/sh";
  try {
    const { stdout } = await execExternal(shellBin, ["-l", "-c", "which cursor"], {
      timeoutMs: 5_000,
      label: "cursor:resolve",
    });
    const resolved = stdout.trim();
    if (resolved && fs.existsSync(resolved)) {
      return resolved;
    }
  } catch {
    /* fall through to known install dirs */
  }
  for (const dir of EXTRA_PATH_SEGMENTS) {
    const candidate = path.join(dir, "cursor");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Open an absolute path (file or folder) plus optional related files in Cursor.
 * Returns an error string when the CLI is missing or a path doesn't exist.
 */
export async function openPathInCursor(absolutePath: string, additionalPaths: string[] = []): Promise<string | null> {
  const paths = [absolutePath, ...additionalPaths];
  if (paths.some((target) => !fs.existsSync(target))) return "Path not found";
  const bin = await resolveCursorBin();
  if (!bin) return "Cursor CLI not found on PATH";
  const child = localOps.spawn(bin, paths, { detached: true, stdio: "ignore" });
  child.unref();
  return null;
}
