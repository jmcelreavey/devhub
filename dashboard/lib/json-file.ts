/**
 * Shared JSON config-file I/O. Used by the MCP and OpenCode config sync paths
 * so reading/writing tool config files (object-rooted, 2-space, trailing
 * newline) has a single implementation.
 */
import fs from "node:fs";
import path from "node:path";

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

/** Parse a JSON file that must contain an object at its root. */
export function readJsonObjectFile(file: string): Record<string, Json> | null {
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, Json>;
    }
    return null;
  } catch {
    return null;
  }
}

/** Write an object as pretty JSON (2-space indent + trailing newline). */
export function writeJsonObjectFile(file: string, data: Record<string, Json>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
