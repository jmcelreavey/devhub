import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import {
  GIT_MAX_BUFFER_BYTES,
  GIT_NETWORK_TIMEOUT_MS,
  isGitNetworkCommand,
  runGitRepo,
  runGitRepoAsync,
} from "./git-repo-local";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeRepoWithBlob(): { root: string; oid: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-git-output-"));
  tempRoots.push(root);
  expect(runGitRepo(root, ["init", "-q"]).status).toBe(0);
  const filePath = path.join(root, "large.txt");
  fs.writeFileSync(filePath, "x".repeat(1_024));
  const hashed = runGitRepo(root, ["hash-object", "-w", filePath]);
  expect(hashed.status).toBe(0);
  return { root, oid: hashed.stdout.trim() };
}

describe("isGitNetworkCommand", () => {
  it("treats fetch, pull, and push as network commands", () => {
    expect(isGitNetworkCommand(["fetch", "origin", "main"])).toBe(true);
    expect(isGitNetworkCommand(["pull", "--rebase", "origin", "main"])).toBe(true);
    expect(isGitNetworkCommand(["push", "origin", "main"])).toBe(true);
  });

  it("treats local commands as non-network", () => {
    expect(isGitNetworkCommand(["status", "--porcelain"])).toBe(false);
    expect(isGitNetworkCommand(["commit", "-m", "msg"])).toBe(false);
    expect(isGitNetworkCommand(["add", "-A"])).toBe(false);
  });

  it("exports a multi-minute default network timeout", () => {
    expect(GIT_NETWORK_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });

  it("uses an explicit output buffer and reports overflow clearly", async () => {
    expect(GIT_MAX_BUFFER_BYTES).toBeGreaterThan(1_024 * 1_024);
    const { root, oid } = makeRepoWithBlob();

    const syncResult = runGitRepo(root, ["cat-file", "blob", oid], { maxBuffer: 32 });
    expect(syncResult.status).not.toBe(0);
    expect(syncResult.stderr).toMatch(/output exceeded.*32-byte limit/i);

    const asyncResult = await runGitRepoAsync(root, ["cat-file", "blob", oid], {
      maxBuffer: 32,
    });
    expect(asyncResult.status).not.toBe(0);
    expect(asyncResult.stderr).toMatch(/output exceeded.*32-byte limit/i);
  });
});
