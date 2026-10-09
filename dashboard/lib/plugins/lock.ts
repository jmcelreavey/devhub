/**
 * Cross-process lock for registry and target mutations.
 * The in-process mutex does not cover a CLI running beside the server.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { ensureSecureDir } from "./runtime";

const WAIT_LIMIT_MS = 20_000;
const POLL_MS = 25;
/** A lock file that is still empty or unreadable this long after creation is garbage, not a writer mid-write. */
const UNREADABLE_GRACE_MS = 5_000;

export class PluginBusyError extends Error {
  constructor() {
    super("Plugin settings are busy. Try again.");
    this.name = "PluginBusyError";
  }
}

/**
 * Lock keys held by the current async call chain. A nested call from inside
 * `fn` re-enters; a concurrent call from anywhere else waits its turn.
 */
const held = new AsyncLocalStorage<ReadonlySet<string>>();

function ownerAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** True when the lock file can be removed because its owner is gone. */
function isStale(file: string): { stale: boolean; observed: string | null } {
  let observed: string;
  try {
    observed = fs.readFileSync(file, "utf8");
  } catch {
    // Vanished between the failed open and now. The caller just retries.
    return { stale: false, observed: null };
  }
  try {
    const parsed = JSON.parse(observed) as { pid?: unknown };
    if (typeof parsed.pid === "number") return { stale: !ownerAlive(parsed.pid), observed };
  } catch {
    // Fall through: the writer may not have finished yet.
  }
  try {
    const age = Date.now() - fs.statSync(file).mtimeMs;
    return { stale: age > UNREADABLE_GRACE_MS, observed };
  } catch {
    return { stale: false, observed: null };
  }
}

function removeIfUnchanged(file: string, observed: string): void {
  try {
    if (fs.readFileSync(file, "utf8") === observed) fs.rmSync(file, { force: true });
  } catch {
    // Someone else recovered or released it first.
  }
}

/**
 * Creates `file` with its content already in place, so a reader never sees a
 * half-written lock. Throws EEXIST when someone else holds it.
 */
function createLockFile(file: string, body: string, token: string): void {
  const temp = `${file}.${token.replace(/:/g, "-")}.tmp`;
  fs.writeFileSync(temp, body, { mode: 0o600 });
  try {
    fs.linkSync(temp, file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") throw err;
    // No hard links on this filesystem: create exclusively and fill in place.
    const fd = fs.openSync(file, "wx", 0o600);
    try {
      fs.writeFileSync(fd, body);
    } finally {
      fs.closeSync(fd);
    }
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

async function acquire(pluginHome: string, waitMs: number): Promise<() => void> {
  const dir = path.join(pluginHome, "locks");
  ensureSecureDir(pluginHome);
  ensureSecureDir(dir);
  const file = path.join(dir, "mutation.lock");
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  const body = JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), token });
  const started = Date.now();
  for (;;) {
    try {
      createLockFile(file, body, token);
      return () => {
        try {
          if (fs.readFileSync(file, "utf8").includes(token)) fs.rmSync(file, { force: true });
        } catch {
          // Already recovered by another process.
        }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    const { stale, observed } = isStale(file);
    if (stale && observed !== null) {
      removeIfUnchanged(file, observed);
      continue;
    }
    if (Date.now() - started > waitMs) throw new PluginBusyError();
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

export async function withPluginMutationLock<T>(
  pluginHome: string,
  fn: () => Promise<T>,
  opts: { waitMs?: number } = {},
): Promise<T> {
  const key = path.resolve(pluginHome);
  const owned = held.getStore();
  if (owned?.has(key)) return fn();
  const release = await acquire(key, opts.waitMs ?? WAIT_LIMIT_MS);
  try {
    return await held.run(new Set([...(owned ?? []), key]), fn);
  } finally {
    release();
  }
}
