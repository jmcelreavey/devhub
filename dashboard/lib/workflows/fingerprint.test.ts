import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { execExternal } from "@/lib/exec-external";
import { worktreeFingerprint } from "./fingerprint";
let cwd: string;
async function git(...args: string[]) { await execExternal("git", args, { cwd }); }
beforeEach(async () => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-git-"));
  await git("init");
  await git("config", "user.name", "Test");
  await git("config", "user.email", "test@example.invalid");
  fs.writeFileSync(path.join(cwd, "file"), "first");
  await git("add", "file");
  await git("commit", "-m", "initial");
});
afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });
it("detects edits, staging changes and untracked changes without storing their contents", async () => {
  const clean = await worktreeFingerprint(cwd);
  fs.writeFileSync(path.join(cwd, "file"), "second");
  const dirty = await worktreeFingerprint(cwd);
  expect(dirty).not.toBe(clean);
  await git("add", "file");
  expect(await worktreeFingerprint(cwd)).not.toBe(dirty);
  const staged = await worktreeFingerprint(cwd);
  fs.writeFileSync(path.join(cwd, "new"), "one");
  const untracked = await worktreeFingerprint(cwd);
  expect(untracked).not.toBe(staged);
  fs.writeFileSync(path.join(cwd, "new"), "two");
  expect(await worktreeFingerprint(cwd)).not.toBe(untracked);
});
