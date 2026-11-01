/**
 * Cross-process lock for registry and target mutations.
 * The in-process mutex does not cover a CLI running beside the server.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { tryAcquireProcessDirectoryLock } from "../process-lock";
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

async function acquire(pluginHome: string, waitMs: number): Promise<() => void> {
  const dir = path.join(pluginHome, "locks");
  assertSafePath(pluginHome, dir);
  ensureSecureDir(pluginHome);
  ensureSecureDir(dir);
  const file = path.join(dir, "mutation.lock");
  const started = Date.now();
  for (;;) {
    assertSafePath(pluginHome, file);
    const release = tryAcquireProcessDirectoryLock(file);
    if (release) return release;
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
