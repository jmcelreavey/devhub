import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getGitUserEmail,
  gitLogLinesLocalMidnightWindow,
  gitUnpushedCount,
  localDatetimeMillis,
  localYesterdayISO,
  millisToLocalGitDatetime,
} from "./standup-git";

const exec = promisify(execFile);

async function gitInitRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-git-"));
  await exec("git", ["init", "-b", "main"], { cwd: dir });
  await exec("git", ["config", "user.email", "alice@example.com"], { cwd: dir });
  await exec("git", ["config", "user.name", "Alice"], { cwd: dir });
  await exec("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  return dir;
}

async function commit(cwd: string, message: string, opts: { email?: string; name?: string } = {}): Promise<void> {
  const file = path.join(cwd, "f.txt");
  fs.appendFileSync(file, `${message}\n`);
  await exec("git", ["add", "."], { cwd });
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: opts.name ?? "Alice",
    GIT_AUTHOR_EMAIL: opts.email ?? "alice@example.com",
    GIT_COMMITTER_NAME: opts.name ?? "Alice",
    GIT_COMMITTER_EMAIL: opts.email ?? "alice@example.com",
  };
  await exec("git", ["commit", "-m", message], { cwd, env });
}

describe("date helpers", () => {
  it("localDatetimeMillis round-trips through millisToLocalGitDatetime", () => {
    const ms = localDatetimeMillis("2026-05-14", "10:30");
    expect(Number.isFinite(ms)).toBe(true);
    expect(millisToLocalGitDatetime(ms)).toMatch(/^2026-05-14 10:30:00$/);
  });

  it("localYesterdayISO returns a valid YYYY-MM-DD", () => {
    const ymd = localYesterdayISO(new Date("2026-05-14T10:00:00"));
    expect(ymd).toBe("2026-05-13");
  });

  it("returns NaN for malformed input", () => {
    expect(localDatetimeMillis("bad", "10:00")).toBeNaN();
    expect(localDatetimeMillis("2026-05-14", "bad")).toBeNaN();
  });
});

describe("getGitUserEmail", () => {
  let repo: string;
  beforeAll(async () => {
    repo = await gitInitRepo();
  });

  it("returns the configured user.email", async () => {
    expect(await getGitUserEmail(repo)).toBe("alice@example.com");
  });

  it("returns null for a non-git directory", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-nogit-"));
    expect(await getGitUserEmail(tmp)).toBeNull();
  });
});

describe("gitLogLinesLocalMidnightWindow", () => {
  it("filters by author email substring-match", async () => {
    const repo = await gitInitRepo();
    await commit(repo, "alice work A", { email: "alice@example.com" });
    await commit(repo, "bob work B", { email: "bob@example.com", name: "Bob" });
    await commit(repo, "alice work C", { email: "alice@example.com" });

    const since = "2026-01-01 00:00:00";
    const until = "2030-12-31 23:59:00";

    const all = await gitLogLinesLocalMidnightWindow(repo, since, until, 10);
    expect(all.lines.length).toBe(3);

    const aliceOnly = await gitLogLinesLocalMidnightWindow(repo, since, until, 10, {
      authorMatch: "alice@example.com",
    });
    expect(aliceOnly.lines.sort()).toEqual(["alice work A", "alice work C"].sort());

    const noMatch = await gitLogLinesLocalMidnightWindow(repo, since, until, 10, {
      authorMatch: "carol@example.com",
    });
    expect(noMatch.lines).toEqual([]);
  });

  it("marks results as truncated when maxLines is exceeded", async () => {
    const repo = await gitInitRepo();
    for (let i = 0; i < 5; i++) await commit(repo, `c${i}`);

    const out = await gitLogLinesLocalMidnightWindow(
      repo,
      "2026-01-01 00:00:00",
      "2030-12-31 23:59:00",
      2,
    );
    expect(out.lines.length).toBe(2);
    expect(out.truncated).toBe(true);
  });

  it("returns empty results for a non-git directory", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-nogit-"));
    const out = await gitLogLinesLocalMidnightWindow(tmp, "1970-01-01", "2030-12-31", 10);
    expect(out.lines).toEqual([]);
    expect(out.truncated).toBe(false);
  });
});

describe("gitUnpushedCount", () => {
  it("counts commits with no remote tracking ref", async () => {
    const repo = await gitInitRepo();
    await commit(repo, "first");
    await commit(repo, "second");
    expect(await gitUnpushedCount(repo)).toBe(2);
  });

  it("returns 0 for a non-git directory", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-nogit-"));
    expect(await gitUnpushedCount(tmp)).toBe(0);
  });
});
