import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { acquireCliUpdateLock, cliLockStatus } from "./cli-update-lock";
let root: string, directory: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-cli-lock-test-")); directory = path.join(root, "updates.lock"); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function deadOwner(dir: string, name: string) {
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, name), JSON.stringify({ pid: 2147483647, token: "dead", acquiredAt: 1 }));
}
it("keeps a live installer exclusive and releases only its own lease", () => {
  const release = acquireCliUpdateLock(directory)!;
  expect(cliLockStatus(directory)).toMatchObject({ held: true, recoverable: false, ownerPid: process.pid });
  expect(acquireCliUpdateLock(directory)).toBeNull();
  release();
  const next = acquireCliUpdateLock(directory)!;
  release(); // A stale release cannot remove a newer owner.
  expect(acquireCliUpdateLock(directory)).toBeNull();
  next();
});
it("recovers a known dead installer and a crashed recovery worker", () => {
  deadOwner(directory, "owner.json");
  deadOwner(directory + ".recovery", "dead-worker");
  expect(cliLockStatus(directory).recoverable).toBe(true);
  const release = acquireCliUpdateLock(directory);
  expect(release).not.toBeNull();
  release!();
  expect(fs.existsSync(directory)).toBe(false);
  expect(fs.existsSync(directory + ".recovery")).toBe(false);
});
it("respects an ownerless legacy lock and does not guess from age", () => {
  fs.mkdirSync(directory);
  expect(acquireCliUpdateLock(directory)).toBeNull();
  expect(fs.readdirSync(directory)).toEqual([]);
});
