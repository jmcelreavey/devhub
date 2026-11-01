import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tryAcquireProcessDirectoryLock } from "./process-lock";

const roots: string[] = [];

function scratch(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-process-lock-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("process directory lock", () => {
  it("does not follow a lock symlink while recovering a stale owner", () => {
    const root = scratch();
    const outside = path.join(root, "outside");
    const lock = path.join(root, "mutation.lock");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "dead"), JSON.stringify({ pid: 2_147_483_646 }));
    fs.symlinkSync(outside, lock, "dir");
    expect(tryAcquireProcessDirectoryLock(lock)).toBeNull();
    expect(fs.existsSync(path.join(outside, "dead"))).toBe(true);
    expect(fs.lstatSync(lock).isSymbolicLink()).toBe(true);
  });

  it("does not recover an owner whose process id is invalid", () => {
    const root = scratch();
    const lock = path.join(root, "mutation.lock");
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, "invalid"), JSON.stringify({ pid: -1 }));
    expect(tryAcquireProcessDirectoryLock(lock)).toBeNull();
    expect(fs.existsSync(path.join(lock, "invalid"))).toBe(true);
  });
});
