import fs from "node:fs";

/**
 * Reads a JSON state file. A missing file is empty state. A file that no longer parses (a
 * half-written disk, a hand edit, a schema from the future) is moved aside as
 * `<file>.corrupt-<time>` and treated as empty, so one bad file can't take Slack down on every
 * message. Real I/O errors (permissions) still throw.
 */
export function readStateFile<State>(file: string, parse: (value: unknown) => State, empty: () => State, now: () => number = Date.now, onReset?: () => void): State {
  let raw: string;
  try { raw = fs.readFileSync(file, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
    throw error;
  }
  try { return parse(JSON.parse(raw)); }
  catch {
    quarantine(file, raw, now());
    onReset?.();
    return empty();
  }
}

function quarantine(file: string, raw: string, at: number): void {
  try {
    // A writer may have replaced the file since we read it; only move aside what we actually saw.
    if (fs.readFileSync(file, "utf8") !== raw) return;
    fs.renameSync(file, `${file}.corrupt-${at}`);
    console.warn(`[slack] ${file.split("/").pop()} was unreadable and has been moved aside; starting empty.`);
  } catch { /* already gone or moved by another reader */ }
}
