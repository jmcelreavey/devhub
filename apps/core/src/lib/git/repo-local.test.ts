import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  GIT_MAX_BUFFER_BYTES,
  GIT_NETWORK_TIMEOUT_MS,
  gitExtractSubtreeArchive,
  isGitNetworkCommand,
  remoteWebUrl,
  runGitRepo,
  runGitRepoAsync,
} from "./repo-local";

const tempRoots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function makeRepoWithBlob(): Promise<{ root: string; oid: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-git-output-"));
  tempRoots.push(root);
  expect((await runGitRepo(root, ["init", "-q"])).status).toBe(0);
  const filePath = path.join(root, "large.txt");
  fs.writeFileSync(filePath, "x".repeat(1_024));
  const hashed = await runGitRepo(root, ["hash-object", "-w", filePath]);
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
    const { root, oid } = await makeRepoWithBlob();

    const syncResult = await runGitRepo(root, ["cat-file", "blob", oid], { maxBuffer: 32 });
    expect(syncResult.status).not.toBe(0);
    expect(syncResult.stderr).toMatch(/output exceeded.*32-byte limit/i);

    const asyncResult = await runGitRepoAsync(root, ["cat-file", "blob", oid], {
      maxBuffer: 32,
    });
    expect(asyncResult.status).not.toBe(0);
    expect(asyncResult.stderr).toMatch(/output exceeded.*32-byte limit/i);
  });
});

describe("remoteWebUrl", () => {
  it("converts the remote shapes a repo is actually cloned with", () => {
    expect(remoteWebUrl("git@github.com:acme/widgets.git")).toBe("https://github.com/acme/widgets");
    expect(remoteWebUrl("ssh://git@github.com/acme/widgets.git")).toBe(
      "https://github.com/acme/widgets",
    );
    expect(remoteWebUrl("ssh://git@ssh.github.com:443/acme/widgets")).toBe(
      "https://ssh.github.com/acme/widgets",
    );
    expect(remoteWebUrl("https://github.com/acme/widgets.git")).toBe(
      "https://github.com/acme/widgets",
    );
    expect(remoteWebUrl("http://git.internal/acme/widgets")).toBe(
      "https://git.internal/acme/widgets",
    );
    expect(remoteWebUrl("https://token:secret@github.com/acme/widgets.git")).toBe(
      "https://github.com/acme/widgets",
    );
  });

  it("returns null when there is nothing browsable", () => {
    expect(remoteWebUrl(null)).toBeNull();
    expect(remoteWebUrl("/srv/git/widgets.git")).toBeNull();
  });
});

describe("gitExtractSubtreeArchive", () => {
  it.skipIf(process.platform === "win32")("does not block the event loop while extracting a binary archive", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-git-archive-"));
    tempRoots.push(root);
    const repo = path.join(root, "repo");
    const bin = path.join(root, "bin");
    const extract = path.join(root, "extract");
    const release = path.join(root, "release");
    fs.mkdirSync(path.join(repo, "skills"), { recursive: true });
    fs.mkdirSync(bin);
    const bytes = Buffer.from([0, 255, 128, 13, 10]);
    fs.writeFileSync(path.join(repo, "skills", "data.bin"), bytes);
    for (const args of [
      ["init", "-q"],
      ["config", "user.name", "Test"],
      ["config", "user.email", "test@example.com"],
      ["config", "commit.gpgsign", "false"],
      ["add", "skills"],
      ["commit", "-qm", "fixture"],
    ]) expect((await runGitRepo(repo, args)).status).toBe(0);

    fs.writeFileSync(path.join(bin, "tar"), [
      "#!/bin/sh",
      "tries=0",
      "while [ ! -f \"$RELEASE_FILE\" ]; do",
      "  tries=$((tries + 1))",
      "  [ \"$tries\" -lt 40 ] || exit 75",
      "  sleep 0.025",
      "done",
      "exec /usr/bin/tar \"$@\"",
      "",
    ].join("\n"), { mode: 0o755 });
    vi.stubEnv("PATH", bin + path.delimiter + (process.env.PATH ?? ""));
    vi.stubEnv("RELEASE_FILE", release);
    const timer = setTimeout(() => fs.writeFileSync(release, "ready"), 50);
    try {
      await gitExtractSubtreeArchive(repo, "HEAD", "skills", extract);
      expect(fs.readFileSync(path.join(extract, "skills", "data.bin"))).toEqual(bytes);
    } finally {
      clearTimeout(timer);
    }
  }, 15_000);
});
