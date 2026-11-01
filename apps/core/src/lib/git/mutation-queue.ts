import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { tryAcquireProcessDirectoryLock } from "../process-lock.ts";

const PROCESS_LOCK_WAIT_MS = 20 * 60_000;
const PROCESS_LOCK_POLL_MS = 100;

interface Lease {
  active: boolean;
  owner?: string;
}

interface QueueState {
  tails: Map<string, Promise<void>>;
  held: AsyncLocalStorage<ReadonlyMap<string, Lease>>;
}

const shared = globalThis as typeof globalThis & { __devhubGitQueue?: QueueState };
const state = shared.__devhubGitQueue ??= {
  tails: new Map(),
  held: new AsyncLocalStorage(),
};

export function resolveGitCommonDir(repoRoot: string): string {
  let root = path.resolve(repoRoot);
  try {
    root = fs.realpathSync(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // --git-dir and bare repositories name the Git directory itself.
  if (fs.existsSync(path.join(root, "HEAD")) && (fs.existsSync(path.join(root, "objects")) || fs.existsSync(path.join(root, "commondir")))) {
    const common = path.join(root, "commondir");
    return fs.existsSync(common) ? path.resolve(root, fs.readFileSync(common, "utf8").trim()) : root;
  }
  const fallback = path.join(root, ".git");
  let dotGit = fallback;
  for (;;) {
    try {
      fs.lstatSync(dotGit);
      break;
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
    const parent = path.dirname(root);
    if (parent === root) return fallback;
    root = parent;
    dotGit = path.join(root, ".git");
  }
  try {
    if (fs.statSync(dotGit).isDirectory()) return dotGit;
    const pointer = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, "utf-8").trim());
    if (!pointer?.[1]) return dotGit;
    const gitDir = path.isAbsolute(pointer[1].trim())
      ? pointer[1].trim()
      : path.resolve(root, pointer[1].trim());
    const commonPath = path.join(gitDir, "commondir");
    let common: string;
    try {
      common = fs.readFileSync(commonPath, "utf-8").trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return gitDir;
      throw error;
    }
    return path.isAbsolute(common) ? common : path.resolve(gitDir, common);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return dotGit;
    throw error;
  }
}

function repoKey(repoRoot: string): string {
  const commonDir = resolveGitCommonDir(path.resolve(repoRoot));
  try {
    return fs.realpathSync(commonDir);
  } catch {
    return path.resolve(commonDir);
  }
}

function aborted(): Error { return Object.assign(new Error("The operation was aborted"), { name: "AbortError", code: "ABORT_ERR" }); }

function cancellable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const stop = () => reject(aborted());
    signal.addEventListener("abort", stop, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

async function acquireProcessLock(commonDir: string, signal?: AbortSignal): Promise<ReturnType<typeof tryAcquireProcessDirectoryLock> | undefined> {
  try {
    if (!fs.statSync(commonDir).isDirectory()) return undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const file = path.join(commonDir, "devhub-mutation.lock");
  const deadline = Date.now() + PROCESS_LOCK_WAIT_MS;
  for (;;) {
    if (signal?.aborted) throw aborted();
    const release = tryAcquireProcessDirectoryLock(file);
    if (release) return release;
    if (Date.now() >= deadline) throw new Error(`Git operations are busy for ${commonDir}. Try again.`);
    await cancellable(new Promise((resolve) => setTimeout(resolve, PROCESS_LOCK_POLL_MS)), signal);
  }
}

function inheritedLease(key: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  try {
    const raw = env.DEVHUB_GIT_LEASES;
    if (!raw || raw.length > 32_768) return undefined;
    const entries: unknown = JSON.parse(raw);
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) return undefined;
    const owner = (entries as Record<string, unknown>)[key];
    if (typeof owner !== "string" || !/^\d+-\d+-[0-9a-f]+$/.test(owner)) return undefined;
    const record = JSON.parse(fs.readFileSync(path.join(key, "devhub-mutation.lock", owner), "utf8")) as { pid?: number; token?: string };
    if (record.token !== owner || !Number.isInteger(record.pid) || (record.pid ?? 0) < 1) return undefined;
    process.kill(record.pid!, 0);
    return owner;
  } catch { return undefined; }
}

/** Hooks inherit the live parent's lease; old or forged owners cannot skip the queue. */
export function gitMutationEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const leases: Record<string, string> = {};
  for (const [key, lease] of state.held.getStore() ?? []) {
    if (lease.active && lease.owner) leases[key] = lease.owner;
  }
  return { ...env, ...(Object.keys(leases).length ? { DEVHUB_GIT_LEASES: JSON.stringify(leases) } : {}) };
}

export async function withRepoGitMutation<T>(repoRoot: string, action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw aborted();
  const key = repoKey(repoRoot);
  const held = state.held.getStore();
  if (held?.get(key)?.active) return action();
  const inherited = inheritedLease(key);
  if (inherited) {
    const lease = { active: true, owner: inherited };
    try { return await state.held.run(new Map(held).set(key, lease), action); }
    finally { lease.active = false; }
  }

  const previous = state.tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const finished = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => finished);
  state.tails.set(key, tail);
  const lease: Lease = { active: true };
  const scope = new Map(held);
  scope.set(key, lease);
  let releaseProcess: ReturnType<typeof tryAcquireProcessDirectoryLock> | undefined;
  try {
    await cancellable(previous, signal);
    releaseProcess = await acquireProcessLock(key, signal);
    lease.owner = releaseProcess?.owner;
    return await state.held.run(scope, action);
  } finally {
    lease.active = false;
    try {
      releaseProcess?.();
    } finally {
      release();
      void tail.then(() => { if (state.tails.get(key) === tail) state.tails.delete(key); });
    }
  }
}
