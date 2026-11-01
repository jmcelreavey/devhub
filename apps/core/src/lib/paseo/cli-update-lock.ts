import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { tryAcquireProcessDirectoryLock } from "../process-lock";

/** Shared with Northing: an empty legacy directory is still an occupied lock. */
export const SHARED_CLI_LOCK = path.join(os.homedir(), ".local/state/agent-cli-updates.lock");
interface Owner { pid: number; token: string; acquiredAt: number }

function owner(directory: string): Owner | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(directory, "owner.json"), "utf8")) as Partial<Owner>;
    if (Number.isSafeInteger(value.pid) && value.pid! > 0 && typeof value.token === "string" &&
      typeof value.acquiredAt === "number") return value as Owner;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; return true; }
}

export function cliLockStatus(directory = SHARED_CLI_LOCK) {
  const holder = owner(directory);
  return { held: fs.existsSync(directory), ownerPid: holder?.pid, recoverable: !!holder && !alive(holder.pid) };
}

/** Only reclaim a known dead owner. Elapsed time never evicts a live installer. */
export function acquireCliUpdateLock(directory = SHARED_CLI_LOCK): (() => void) | null {
  fs.mkdirSync(path.dirname(directory), { recursive: true, mode: 0o700 });
  const token = randomUUID();
  const claim = () => {
    try { fs.mkdirSync(directory, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
    try {
      fs.writeFileSync(path.join(directory, "owner.json"), JSON.stringify({ pid: process.pid, token, acquiredAt: Date.now() }), { flag: "wx", mode: 0o600 });
    } catch (error) {
      fs.rmdirSync(directory);
      throw error;
    }
    return true;
  };
  if (!claim()) {
    const holder = owner(directory);
    if (!holder || alive(holder.pid)) return null;
    // Serialize reapers, then re-read: another process may already have recovered it.
    const recovery = directory + ".recovery";
    const releaseRecovery = tryAcquireProcessDirectoryLock(recovery);
    if (!releaseRecovery) return null;
    try {
      const current = owner(directory);
      if (!current || current.token !== holder.token || alive(current.pid)) return null;
      fs.unlinkSync(path.join(directory, "owner.json"));
      fs.rmdirSync(directory);
      if (!claim()) return null;
    } finally { releaseRecovery(); }
  }
  return () => {
    if (owner(directory)?.token !== token) return;
    fs.unlinkSync(path.join(directory, "owner.json"));
    fs.rmdirSync(directory);
  };
}
