import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { slackStateRoot } from "./store";

/**
 * One Socket Mode connection per machine. Slack spreads events across every connection that shares
 * an app token, so a second DevHub process (a dev server beside DevHub.app) would take half of them
 * and could post a second copy of every Needs-you card. The holder writes its pid and a heartbeat to
 * `socket.lock` in the Slack state dir; a lock is stale when that pid is gone or the heartbeat stops.
 */
export const LOCK_HEARTBEAT_MS = 15_000;
export const LOCK_STALE_MS = 90_000;
const LOCK_FILE = "socket.lock";

interface LockBody { pid: number; startedAt: number; heartbeatAt: number; token?: string }

export interface SlackLockDependencies {
  pid: number;
  now: () => number;
  isAlive: (pid: number) => boolean;
}

export type SlackLockResult = { ok: true; lock: SlackLock } | { ok: false; holderPid: number };

export interface SlackLock {
  /** Still ours? False once another process took over (e.g. after a long sleep). */
  held: () => boolean;
  /** Refresh the heartbeat on a timer. False once the lock is no longer ours. */
  heartbeat: () => boolean;
  release: () => void;
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

const defaults = (): SlackLockDependencies => ({ pid: process.pid, now: Date.now, isAlive: processAlive });

function readLock(file: string): LockBody | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<LockBody>;
    return Number.isInteger(parsed.pid) && parsed.pid! > 0 && Number.isFinite(parsed.startedAt) && Number.isFinite(parsed.heartbeatAt) ? parsed as LockBody : undefined;
  } catch { return undefined; }
}

function stale(body: LockBody | undefined, file: string, deps: SlackLockDependencies): boolean {
  if (!body) return deps.now() - fs.statSync(file).mtimeMs > LOCK_STALE_MS;
  return !deps.isAlive(body.pid) || deps.now() - body.heartbeatAt > LOCK_STALE_MS;
}

function guard(file: string, deps: SlackLockDependencies): (() => void) | undefined {
  const directory = `${file}.guard`;
  const token = randomUUID();
  const temporary = `${directory}.${token}.tmp`;
  fs.mkdirSync(temporary, { mode: 0o700 });
  fs.writeFileSync(path.join(temporary, token), JSON.stringify({ pid: deps.pid, startedAt: deps.now(), heartbeatAt: deps.now() }), { mode: 0o600 });
  const release = (owner: string) => {
    try { fs.unlinkSync(path.join(directory, owner)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    try { fs.rmdirSync(directory); } catch (error) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
  };
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { fs.renameSync(temporary, directory); return () => release(token); }
      catch (error) { if (!["ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
      let owners: string[];
      try { owners = fs.readdirSync(directory); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      for (const owner of owners) {
        const body = readLock(path.join(directory, owner));
        if (/^[\w-]+$/.test(owner) && body && !deps.isAlive(body.pid)) release(owner);
      }
    }
    return undefined;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

/** Takes the lock if free or stale. Never throws on contention; a real I/O failure does throw. */
export function acquireSlackLock(root = slackStateRoot(), overrides: Partial<SlackLockDependencies> = {}): SlackLockResult {
  const deps = { ...defaults(), ...overrides };
  const file = path.join(root, LOCK_FILE);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const startedAt = deps.now();
  const token = randomUUID();
  const write = () => {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ pid: deps.pid, startedAt, heartbeatAt: deps.now(), token } satisfies LockBody), { flag: "wx", mode: 0o600 });
      fs.renameSync(temporary, file);
    } finally { fs.rmSync(temporary, { force: true }); }
  };
  const unlock = guard(file, deps);
  if (!unlock) return { ok: false, holderPid: readLock(file)?.pid ?? 0 };
  try {
    if (fs.existsSync(file)) {
      const holder = readLock(file);
      if (!stale(holder, file, deps)) return { ok: false, holderPid: holder?.pid ?? 0 };
    }
    write();
  } finally { unlock(); }
  const mine = () => readLock(file)?.token === token;
  function mutate(work: () => void): boolean {
    const release = guard(file, deps);
    if (!release) return mine();
    try {
      if (!mine()) return false;
      work();
      return true;
    } finally { release(); }
  }
  if (!mine()) return { ok: false, holderPid: readLock(file)?.pid ?? 0 };
  return {
    ok: true,
    lock: {
      held: mine,
      heartbeat() {
        return mutate(write);
      },
      release() {
        mutate(() => fs.rmSync(file, { force: true }));
      },
    },
  };
}
