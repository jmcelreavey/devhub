import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireSlackLock, LOCK_STALE_MS } from "./process-lock";

let root: string;
let clock: number;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "slack-lock-")); clock = 1_000_000; });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const alive = new Set<number>([111, 222]);
const as = (pid: number) => ({ pid, now: () => clock, isAlive: (other: number) => alive.has(other) });
const file = () => path.join(root, "socket.lock");

describe("Socket Mode process lock", () => {
  it("lets the first process connect and keeps the file private", () => {
    const result = acquireSlackLock(root, as(111));
    expect(result.ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(file(), "utf8"))).toMatchObject({ pid: 111 });
    expect(fs.statSync(file()).mode & 0o777).toBe(0o600);
  });
  it("turns a second live process away and says who holds it", () => {
    acquireSlackLock(root, as(111));
    expect(acquireSlackLock(root, as(222))).toEqual({ ok: false, holderPid: 111 });
    expect(JSON.parse(fs.readFileSync(file(), "utf8")).pid).toBe(111);
  });
  it("takes over from a dead process", () => {
    acquireSlackLock(root, as(111));
    alive.delete(111);
    try {
      const second = acquireSlackLock(root, as(222));
      expect(second.ok).toBe(true);
      expect(JSON.parse(fs.readFileSync(file(), "utf8")).pid).toBe(222);
    } finally { alive.add(111); }
  });
  it("takes over when the heartbeat has stopped, but not while it keeps beating", () => {
    const first = acquireSlackLock(root, as(111));
    clock += LOCK_STALE_MS - 1000;
    expect(acquireSlackLock(root, as(222)).ok).toBe(false);
    if (first.ok) expect(first.lock.heartbeat()).toBe(true);
    clock += LOCK_STALE_MS - 1000;
    expect(acquireSlackLock(root, as(222)).ok).toBe(false);
    clock += 2000;
    expect(acquireSlackLock(root, as(222)).ok).toBe(true);
  });
  it.each(["not json", "{}", "null", JSON.stringify({ pid: 111, heartbeatAt: 0 })])("treats partial or unreadable metadata as live until its mtime is stale: %s", (metadata) => {
    fs.writeFileSync(file(), metadata);
    fs.utimesSync(file(), clock / 1000, clock / 1000);
    expect(acquireSlackLock(root, as(111)).ok).toBe(false);
    clock += LOCK_STALE_MS + 1;
    expect(acquireSlackLock(root, as(111)).ok).toBe(true);
  });
  it("keeps a concurrent contender out while heartbeat metadata is atomically replaced", () => {
    const first = acquireSlackLock(root, as(111));
    if (!first.ok) throw new Error("expected lock");
    const rename = fs.renameSync;
    const contender = vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      if (target === file()) {
        expect(JSON.parse(fs.readFileSync(file(), "utf8")).pid).toBe(111);
        expect(acquireSlackLock(root, as(222)).ok).toBe(false);
      }
      return rename(source, target);
    });
    try { for (let beat = 0; beat < 25; beat++) { clock += 1000; expect(first.lock.heartbeat()).toBe(true); } }
    finally { contender.mockRestore(); }
    expect(acquireSlackLock(root, as(222)).ok).toBe(false);
    first.lock.release(); expect(acquireSlackLock(root, as(222)).ok).toBe(true);
  });
  it("does not let a duplicate acquisition in the same process replace its live owner", () => {
    expect(acquireSlackLock(root, as(111)).ok).toBe(true);
    expect(acquireSlackLock(root, as(111)).ok).toBe(false);
  });
  it("releases only its own lock, so a late release can't free someone else's", () => {
    const first = acquireSlackLock(root, as(111));
    if (!first.ok) throw new Error("expected the lock");
    first.lock.release();
    expect(fs.existsSync(file())).toBe(false);
    const second = acquireSlackLock(root, as(222));
    first.lock.release();
    expect(fs.existsSync(file())).toBe(true);
    expect(first.lock.held()).toBe(false);
    expect(first.lock.heartbeat()).toBe(false);
    expect(second.ok).toBe(true);
  });
  it("lets another process in after a clean release", () => {
    const first = acquireSlackLock(root, as(111));
    if (first.ok) first.lock.release();
    expect(acquireSlackLock(root, as(222)).ok).toBe(true);
  });
});
