import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tryAcquireProcessDirectoryLock } from "./directory-lock";

const roots: string[] = [];

function lockPath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-lock-"));
  roots.push(root);
  return path.join(root, "mutation.lock");
}

/** Plant an owner file directly — simulates a lease that was never released. */
function plantOwner(lock: string, pid: number, ageMs: number): void {
  fs.mkdirSync(lock, { recursive: true, mode: 0o700 });
  const token = `${pid}-${Date.now()}-deadbeef`;
  const file = path.join(lock, token);
  fs.writeFileSync(file, JSON.stringify({ pid, token }), { mode: 0o600 });
  if (ageMs > 0) {
    const then = new Date(Date.now() - ageMs);
    fs.utimesSync(file, then, then);
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("process directory lock", () => {
  it("serializes two acquisitions and frees on release", () => {
    const lock = lockPath();
    const first = tryAcquireProcessDirectoryLock(lock);
    expect(first).not.toBeNull();
    expect(tryAcquireProcessDirectoryLock(lock)).toBeNull();
    first!();
    expect(tryAcquireProcessDirectoryLock(lock)).not.toBeNull();
  });

  it("recovers an owner whose process is gone", () => {
    const lock = lockPath();
    // PID 2^22+ is almost certainly unused and ownerAlive reports ESRCH.
    plantOwner(lock, 4_194_303, 0);
    expect(tryAcquireProcessDirectoryLock(lock)).not.toBeNull();
  });

  it("recovers a live-pid owner that has exceeded the maximum lease age", () => {
    const lock = lockPath();
    plantOwner(lock, process.pid, 16 * 60_000);
    expect(tryAcquireProcessDirectoryLock(lock)).not.toBeNull();
  });

  it("does not steal a fresh lease from a live process", () => {
    const lock = lockPath();
    plantOwner(lock, process.pid, 0);
    expect(tryAcquireProcessDirectoryLock(lock)).toBeNull();
  });
});
