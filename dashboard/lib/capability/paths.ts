import path from "node:path";
import { getRepoRoot } from "@/lib/notes-dir";

/**
 * Absolute path inside the (gitignored) Capability Radar cache under
 * `notes/.cache/capability/…`. Pass sub-segments, e.g.
 * `capabilityCacheDir("labs")` or `capabilityCacheDir("digests", `${id}.json`)`.
 */
export function capabilityCacheDir(...segments: string[]): string {
  return path.join(getRepoRoot(), "notes", ".cache", "capability", ...segments);
}

/** Make a string safe to use as a single filesystem path segment. */
export function safeSegment(value: string, replacement = "_"): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, replacement);
}
