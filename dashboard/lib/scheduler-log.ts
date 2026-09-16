/**
 * Scheduler activity log: ~/.local/state/devhub/scheduler.log.
 *
 * Console output already reaches the desktop log, but that file is shared
 * with everything else, does not exist in a browser/dev session, and is not
 * reachable over MCP. This one is scheduler-only, survives restarts, and is
 * what GET /api/jobs/log and the jobs_log MCP tool read. Every line still
 * goes to the console too.
 */
import fs from "node:fs";
import path from "node:path";
import { getHome } from "@/lib/notes/dir";

export type SchedulerLogLevel = "info" | "warn" | "error";

/** Rotated to scheduler.log.1 past this size, so the file never grows unbounded. */
const MAX_BYTES = 1_000_000;
/** How much of a file tail reads look at — plenty for 1000 lines. */
const TAIL_BYTES = 512_000;

/** Where launchd sends the root wake helper's stderr. */
export const WAKE_HELPER_LOG = "/var/log/com.devhub.wake-helper.log";

export function schedulerLogFile(): string {
  return path.join(/*turbopackIgnore: true*/ getHome(), ".local/state/devhub/scheduler.log");
}

let writeFailureReported = false;

export function appendSchedulerLog(level: SchedulerLogLevel, source: string, message: string, now = new Date()): void {
  const consoleLine = `[${source}] ${message}`;
  if (level === "info") console.info(consoleLine);
  else if (level === "warn") console.warn(consoleLine);
  else console.error(consoleLine);

  const file = schedulerLogFile();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      if (fs.statSync(/*turbopackIgnore: true*/ file).size > MAX_BYTES) fs.renameSync(file, `${file}.1`);
    } catch {
      // No file yet.
    }
    fs.appendFileSync(/*turbopackIgnore: true*/ file, `${now.toISOString()} ${level.toUpperCase().padEnd(5)} ${consoleLine}\n`);
    writeFailureReported = false;
  } catch (err) {
    // Logging must never break the scheduler; say so once rather than per line.
    if (!writeFailureReported) {
      writeFailureReported = true;
      console.warn(`[scheduler] could not write ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function readTail(file: string, bytes: number): string {
  const fd = fs.openSync(/*turbopackIgnore: true*/ file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    const text = buffer.toString("utf8");
    // Drop the partial first line when the read started mid-file.
    return start > 0 ? text.slice(text.indexOf("\n") + 1) : text;
  } finally {
    fs.closeSync(fd);
  }
}

/** The last `limit` lines (oldest first), optionally only those containing `match`. Missing or unreadable → []. */
export function tailLines(file: string, limit: number, match?: string): string[] {
  let text: string;
  try {
    text = readTail(file, TAIL_BYTES);
  } catch {
    return [];
  }
  const lines = text.split("\n").filter((line) => line.length > 0 && (!match || line.includes(match)));
  return lines.slice(-limit);
}
