/**
 * Cross-process lock for registry and target mutations.
 * The in-process mutex does not cover a CLI running beside the server.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { ensureSecureDir } from "./runtime";
import { assertSafePath } from "./filesystem";
import type { PluginPaths } from "./paths";

const WAIT_LIMIT_MS = 20_000;
const POLL_MS = 25;

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
interface Lease { active: boolean }
const held = new AsyncLocalStorage<ReadonlyMap<string, Lease>>();

/** Both identities matter when two processes share a registry but override download storage. */
export async function withPluginPathsLock<T>(paths: Pick<PluginPaths, "pluginHome" | "configDir">, fn: () => Promise<T>): Promise<T> {
  const roots = [...new Set([path.resolve(paths.configDir), path.resolve(paths.pluginHome)])].sort();
  const take = (index: number): Promise<T> => index === roots.length ? fn() : withPluginMutationLock(roots[index], () => take(index + 1));
  return take(0);
}

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
function isStale(file: string): boolean {
  let observed: string;
  try {
    observed = fs.readFileSync(file, "utf8");
  } catch {
    // Vanished between the failed open and now. The caller just retries.
    return false;
  }
  try {
    const parsed = JSON.parse(observed) as { pid?: unknown };
    if (typeof parsed.pid === "number") return !ownerAlive(parsed.pid);
  } catch {
    // Fall through: the writer may not have finished yet.
  }
  // Age alone never proves that a writer is gone.
  return false;
}

function releaseDirectory(dir: string, owner: string): void {
  try {
    fs.unlinkSync(path.join(dir, owner));
  } catch {
    // Another reaper may have removed this exact owner's file already.
  }
  try { fs.rmdirSync(dir); } catch { /* A new owner's nonempty directory is never removed. */ }
}

/**
 * Publish a populated directory atomically. Rename cannot replace a nonempty
 * directory. Recovery removes only the dead owner's uniquely named file,
 * then rmdir: a competing new owner's populated directory survives both.
 */
function createLockFile(file: string, body: string, token: string): void {
  const temp = `${file}.${token}.tmp`;
  fs.mkdirSync(temp, { mode: 0o700 });
  fs.writeFileSync(path.join(temp, token), body, { mode: 0o600 });
  try {
    fs.renameSync(temp, file);
  } catch (err) {
    if (["ENOTEMPTY", "EEXIST", "ENOTDIR"].includes((err as NodeJS.ErrnoException).code ?? "")) throw Object.assign(new Error("busy"), { code: "EEXIST" });
    throw err;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

async function acquire(pluginHome: string, waitMs: number): Promise<() => void> {
  const dir = path.join(pluginHome, "locks");
  assertSafePath(pluginHome, dir);
  ensureSecureDir(pluginHome);
  ensureSecureDir(dir);
  const file = path.join(dir, "mutation.lock");
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const body = JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), token });
  const started = Date.now();
  for (;;) {
    assertSafePath(pluginHome, file);
    try {
      createLockFile(file, body, token);
      return () => releaseDirectory(file, token);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    try {
      for (const owner of fs.readdirSync(file)) {
        if (/^[\w-]+$/.test(owner) && isStale(path.join(file, owner))) releaseDirectory(file, owner);
      }
    } catch { /* Legacy or malformed locks fail closed; never unlink a path after a racy read. */ }
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
  if (owned?.get(key)?.active) return fn();
  const release = await acquire(key, opts.waitMs ?? WAIT_LIMIT_MS);
  const lease: Lease = { active: true };
  const scope = new Map(owned);
  scope.set(key, lease);
  try {
    return await held.run(scope, fn);
  } finally {
    lease.active = false;
    release();
  }
}
