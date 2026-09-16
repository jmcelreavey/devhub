/**
 * Keep the Mac awake while a scheduled job is about to run or running.
 *
 * A scheduled wake alone is not enough: macOS drops back to sleep within a
 * couple of idle minutes, which is shorter than most jobs. One `caffeinate`
 * process holds an idle-sleep assertion while anything needs it, and `-w`
 * ties it to this server so a crashed dashboard can never pin the Mac awake.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { appendSchedulerLog } from "./scheduler-log";

const holds = new Map<string, () => boolean>();
let caffeinate: ChildProcess | null = null;

function ensureAssertion(reason: string): void {
  if (process.platform !== "darwin" || caffeinate) return;
  try {
    const child = spawn("/usr/bin/caffeinate", ["-i", "-s", "-w", String(process.pid)], { stdio: "ignore" });
    child.on("error", (err) => {
      appendSchedulerLog("warn", "keep-awake", `caffeinate failed: ${err.message}`);
      if (caffeinate === child) caffeinate = null;
    });
    child.on("exit", () => {
      if (caffeinate === child) caffeinate = null;
    });
    child.unref();
    caffeinate = child;
    appendSchedulerLog("info", "keep-awake", `holding the Mac awake for ${reason} (caffeinate pid ${child.pid})`);
  } catch (err) {
    appendSchedulerLog("warn", "keep-awake", `could not start caffeinate: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Hold the Mac awake until `isDone()` returns true. Re-holding a key replaces it. */
export function holdAwake(key: string, isDone: () => boolean): void {
  holds.set(key, isDone);
  ensureAssertion(key);
}

/** Drop finished holds; release the assertion once none remain. Call on each scheduler tick. */
export function releaseFinishedHolds(): void {
  for (const [key, isDone] of holds) {
    let done = true;
    try {
      done = isDone();
    } catch {
      // A hold whose check throws can never report done; drop it rather than pin the Mac.
    }
    if (done) holds.delete(key);
  }
  if (holds.size === 0 && caffeinate) {
    caffeinate.kill();
    caffeinate = null;
    appendSchedulerLog("info", "keep-awake", "released — nothing scheduled needs the Mac awake");
  }
}

export function activeHoldCount(): number {
  return holds.size;
}
