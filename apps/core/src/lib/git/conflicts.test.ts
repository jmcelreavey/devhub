import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../http/routes/status/git/route";
import { POST as resolveCoreConflict } from "../../http/routes/git/conflicts/route";
import { GET as getRepoStatus } from "../../http/routes/repos/[name]/git/status/route";
import { GET as getRepoConflicts, POST as resolveRepoConflict } from "../../http/routes/repos/[name]/git/conflicts/route";
import { POST as stageRepoFiles } from "../../http/routes/repos/[name]/git/stage/route";
import {
  detectMarkerConflicts,
  readConflictFileContent,
  readConflictSides,
  resolveConflictFile,
  resolveConflictSide,
} from "./conflicts";
import { parseConflictHunks, resolveConflictHunk } from "../../../../../packages/shared/ui-lib/git/conflict-markers";
import { gitEnv, runGitRepo } from "./repo-local";
import { assessGitAvailability, clearGitAvailabilityCache } from "../setup/git-availability";

async function mkTempRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-git-conflict-"));
  await runGitRepo(dir, ["init"]);
  await runGitRepo(dir, ["config", "user.email", "test@example.com"]);
  await runGitRepo(dir, ["config", "user.name", "Test"]);
  return dir;
}

const repos: string[] = [];

async function makeConflictedRepo(): Promise<string> {
  const repo = await mkTempRepo();
  repos.push(repo);
  fs.writeFileSync(path.join(repo, "file.txt"), "base\n");
  await runGitRepo(repo, ["add", "file.txt"]);
  await runGitRepo(repo, ["commit", "-m", "base"]);
  // `git init`'s default branch name depends on this machine's
  // init.defaultBranch (main, master, ...) — read it back instead of
  // assuming "master", or the checkout below silently no-ops and both
  // commits land on the same branch.
  const initialBranch = (await runGitRepo(repo, ["branch", "--show-current"])).stdout.trim();
  await runGitRepo(repo, ["checkout", "-b", "theirs"]);
  fs.writeFileSync(path.join(repo, "file.txt"), "theirs\n");
  await runGitRepo(repo, ["commit", "-am", "theirs"]);
  await runGitRepo(repo, ["checkout", initialBranch]);
  fs.writeFileSync(path.join(repo, "file.txt"), "ours\n");
  await runGitRepo(repo, ["commit", "-am", "ours"]);
  expect((await runGitRepo(repo, ["merge", "theirs"])).status).not.toBe(0);
  return repo;
}

afterEach(() => {
  vi.unstubAllEnvs();
  clearGitAvailabilityCache();
  for (const dir of repos.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("git-conflicts", () => {
  it("detects conflict markers in content sync paths", async () => {
    const repo = await mkTempRepo();
    repos.push(repo);
    const notePath = path.join(repo, "notes", "daily", "test.json");
    fs.mkdirSync(path.dirname(notePath), { recursive: true });
    fs.writeFileSync(notePath, '<<<<<<< HEAD\n{"a":1}\n=======\n{"b":2}\n>>>>>>> branch\n', "utf-8");
    const conflicts = detectMarkerConflicts(repo);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].path).toBe("notes/daily/test.json");
  });

  it("resolveConflictFile rejects unresolved markers", async () => {
    const repo = await mkTempRepo();
    repos.push(repo);
    const result = await resolveConflictFile(repo, "notes/foo.json", "<<<<<<< HEAD\nx\n>>>>>>> y\n", null);
    expect(result.ok).toBe(false);
  });

  it.skipIf(process.platform === "win32")("refuses to read or resolve symlinks outside the repo", async () => {
    const repo = await mkTempRepo();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-git-outside-"));
    repos.push(repo, outside);
    const outsideFile = path.join(outside, "file.txt");
    const original = "<<<<<<< HEAD\noriginal\n=======\nother\n>>>>>>> branch\n";
    fs.writeFileSync(outsideFile, original);
    fs.symlinkSync(outsideFile, path.join(repo, "link.txt"));
    fs.symlinkSync(outside, path.join(repo, "linked-dir"));
    fs.symlinkSync(outside, path.join(repo, "notes"));
    fs.writeFileSync(path.join(repo, "inside.txt"), original);
    fs.symlinkSync(path.join(repo, "inside.txt"), path.join(repo, "inside-link.txt"));

    for (const filePath of ["link.txt", "linked-dir/file.txt", "linked-dir/new/file.txt", "inside-link.txt"]) {
      const expected = filePath.endsWith("new/file.txt") ? null : original;
      expect((await resolveConflictFile(repo, filePath, "resolved\n", expected)).ok).toBe(false);
      expect(readConflictFileContent(repo, filePath)).toBeNull();
      expect(fs.readFileSync(outsideFile, "utf-8")).toBe(original);
    }
    expect(detectMarkerConflicts(repo)).toEqual([]);
    fs.unlinkSync(path.join(repo, "notes"));
    fs.mkdirSync(path.join(repo, "notes"));
    fs.symlinkSync(outsideFile, path.join(repo, "notes", "link.txt"));
    expect(detectMarkerConflicts(repo)).toEqual([]);
    expect(fs.readFileSync(path.join(repo, "inside.txt"), "utf-8")).toBe(original);
    expect(fs.existsSync(path.join(outside, "new"))).toBe(false);
    vi.stubEnv("REPO_ROOT", repo);
    const response = await resolveCoreConflict(new Request("http://localhost/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "link.txt", content: "resolved\n", expectedContent: original }),
    }));
    expect(response.status).toBe(400);
    expect(fs.readFileSync(outsideFile, "utf-8")).toBe(original);
  });

  it.skipIf(process.platform === "win32")("refuses a parent swapped for an outside symlink while opening", async () => {
    const repo = await mkTempRepo();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-git-outside-"));
    repos.push(repo, outside);
    const parent = path.join(repo, "notes", "daily");
    const file = path.join(parent, "file.txt");
    const outsideFile = path.join(outside, "file.txt");
    const original = "<<<<<<< HEAD\noriginal\n=======\nother\n>>>>>>> branch\n";
    fs.mkdirSync(parent, { recursive: true });
    fs.writeFileSync(file, original);
    fs.writeFileSync(outsideFile, original);

    for (const operation of ["read", "resolve", "create", "scan"] as const) {
      const open = fs.openSync;
      let swapped = false;
      const spy = vi.spyOn(fs, "openSync").mockImplementation((filePath, flags, mode) => {
        if (String(filePath).startsWith(`${parent}${path.sep}`) && !swapped) {
          swapped = true;
          fs.renameSync(parent, `${parent}-original`);
          fs.symlinkSync(outside, parent);
        }
        return open(filePath, flags, mode);
      });
      try {
        if (operation === "read") expect(readConflictFileContent(repo, "notes/daily/file.txt")).toBeNull();
        if (operation === "resolve") expect((await resolveConflictFile(repo, "notes/daily/file.txt", "resolved\n", original)).ok).toBe(false);
        if (operation === "create") expect((await resolveConflictFile(repo, "notes/daily/created.txt", "resolved\n", null)).ok).toBe(false);
        if (operation === "scan") expect(detectMarkerConflicts(repo)).toEqual([]);
        expect(swapped).toBe(true);
        expect(fs.readFileSync(outsideFile, "utf-8")).toBe(original);
        expect(fs.readdirSync(outside)).toEqual(["file.txt"]);
      } finally {
        spy.mockRestore();
        if (swapped) {
          fs.unlinkSync(parent);
          fs.renameSync(`${parent}-original`, parent);
        }
      }
    }

    fs.linkSync(outsideFile, path.join(repo, "hard-link.txt"));
    expect((await resolveConflictFile(repo, "hard-link.txt", "resolved\n", original)).ok).toBe(false);
    expect(fs.readFileSync(outsideFile, "utf-8")).toBe(original);
    expect(await resolveConflictFile(repo, "notes/daily/new.txt", "resolved\n", null)).toEqual({ ok: true });
    expect(await resolveConflictFile(repo, "notes/daily/new.txt", "changed\n", null)).toMatchObject({ code: "content_changed" });
  });

  it.skipIf(process.platform === "win32").each([false, true])("does not redirect cleanup through a second parent symlink swap (inside: %s)", async (inside) => {
    const repo = await mkTempRepo();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-git-outside-"));
    repos.push(repo, outside);
    const first = path.join(inside ? repo : outside, "first");
    const second = path.join(outside, "second");
    const parent = path.join(repo, "notes");
    const file = path.join(parent, "file.txt");
    fs.mkdirSync(first);
    fs.mkdirSync(second);
    fs.mkdirSync(parent);
    fs.writeFileSync(path.join(second, "file.txt"), "keep me\n");
    const open = fs.openSync;
    const unlink = fs.unlinkSync;
    const openSpy = vi.spyOn(fs, "openSync").mockImplementation((filePath, flags, mode) => {
      if (filePath === file) {
        fs.renameSync(parent, `${parent}-original`);
        fs.symlinkSync(first, parent);
      }
      return open(filePath, flags, mode);
    });
    const unlinkSpy = vi.spyOn(fs, "unlinkSync").mockImplementation((filePath) => {
      if (String(filePath).endsWith(`${path.sep}file.txt`)) {
        if (inside) {
          fs.renameSync(first, `${first}-original`);
          fs.symlinkSync(second, first);
        } else {
          unlink(parent);
          fs.symlinkSync(second, parent);
        }
      }
      unlink(filePath);
    });
    try {
      expect((await resolveConflictFile(repo, "notes/file.txt", "resolved\n", null)).ok).toBe(false);
      expect(fs.readFileSync(path.join(second, "file.txt"), "utf-8")).toBe("keep me\n");
      expect(fs.existsSync(path.join(first, "file.txt"))).toBe(inside);
    } finally {
      openSpy.mockRestore();
      unlinkSpy.mockRestore();
    }
  });

  it.skipIf(process.platform === "win32")("saves a read-only conflict file and keeps its mode", async () => {
    const repo = await makeConflictedRepo();
    const file = path.join(repo, "file.txt");
    const conflict = fs.readFileSync(file, "utf-8");
    fs.chmodSync(file, 0o444);
    expect(await resolveConflictFile(repo, "file.txt", "resolved\n", conflict)).toEqual({ ok: true });
    expect(fs.readFileSync(file, "utf-8")).toBe("resolved\n");
    expect(fs.statSync(file).mode & 0o777).toBe(0o444);
  });

  it.skipIf(process.platform === "win32")("refuses to chmod a read-only hard link outside the repo", async () => {
    const repo = await mkTempRepo();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-git-outside-"));
    repos.push(repo, outside);
    const outsideFile = path.join(outside, "file.txt");
    const original = "original conflict\n";
    fs.writeFileSync(outsideFile, original, { mode: 0o444 });
    fs.linkSync(outsideFile, path.join(repo, "file.txt"));
    const chmod = vi.spyOn(fs, "fchmodSync");
    try {
      expect((await resolveConflictFile(repo, "file.txt", "resolved\n", original)).ok).toBe(false);
      expect(chmod).not.toHaveBeenCalled();
      expect(fs.statSync(outsideFile).mode & 0o777).toBe(0o444);
      expect(fs.readFileSync(outsideFile, "utf-8")).toBe(original);
    } finally {
      chmod.mockRestore();
    }
  });

  it("refuses to overwrite a conflict changed since it was read", async () => {
    const repo = await mkTempRepo();
    repos.push(repo);
    vi.stubEnv("DEVHUB_REPOS_DIR", path.dirname(repo));
    const filePath = "notes/file.txt";
    const editorContent = "<<<<<<< HEAD\neditor changes\n=======\nother\n>>>>>>> branch\n";
    fs.mkdirSync(path.join(repo, "notes"));
    fs.writeFileSync(path.join(repo, filePath), editorContent);

    const result = await resolveConflictFile(repo, filePath, "resolved\n", "original conflict\n");

    expect(result).toMatchObject({ ok: false, code: "content_changed" });
    expect(fs.readFileSync(path.join(repo, filePath), "utf-8")).toBe(editorContent);
    const response = await resolveRepoConflict(new Request("http://localhost/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "resolve", path: filePath, content: "resolved\n", expectedContent: "original conflict\n" }),
    }), { params: Promise.resolve({ name: path.basename(repo) }) });
    expect(response.status).toBe(409);
    expect(fs.readFileSync(path.join(repo, filePath), "utf-8")).toBe(editorContent);

    expect(await resolveConflictFile(repo, filePath, "resolved\n", editorContent)).toEqual({ ok: true });
    expect(fs.readFileSync(path.join(repo, filePath), "utf-8")).toBe("resolved\n");
    expect((await runGitRepo(repo, ["show", `:${filePath}`])).stdout).toBe("resolved\n");
    expect(fs.readdirSync(path.join(repo, "notes")).filter((entry) => entry.includes(".devhub-"))).toEqual([]);
  });

  it.each([
    { rollbackFails: false, modeRestoreFails: false },
    { rollbackFails: true, modeRestoreFails: false },
    { rollbackFails: true, modeRestoreFails: true },
  ].filter(({ modeRestoreFails }) => !modeRestoreFails || (process.platform !== "win32" && process.getuid?.() !== 0)))("preserves the conflict after a partial write (rollback: $rollbackFails, mode restore: $modeRestoreFails)", async ({ rollbackFails, modeRestoreFails }) => {
    const repo = await mkTempRepo();
    const recoveryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-conflict-backup-test-"));
    repos.push(repo, recoveryRoot);
    const tmpdir = vi.spyOn(os, "tmpdir").mockReturnValue(recoveryRoot);
    const file = path.join(repo, "file.txt");
    const original = "<<<<<<< HEAD\nmanual edits\n=======\nother\n>>>>>>> branch\n";
    fs.writeFileSync(file, original);
    if (process.platform !== "win32") fs.chmodSync(file, 0o444);
    const chmod = fs.fchmodSync;
    const chmodSpy = vi.spyOn(fs, "fchmodSync").mockImplementation((fd, mode) => {
      if (modeRestoreFails && mode === 0o444) throw new Error("Mode restore failed");
      chmod(fd, mode);
    });
    const target = fs.statSync(file);
    const write = fs.writeSync;
    let targetWrites = 0;
    const spy = vi.spyOn(fs, "writeSync").mockImplementation((...args) => {
      const [fd, buffer] = args;
      const opened = fs.fstatSync(fd);
      if (opened.dev === target.dev && opened.ino === target.ino) {
        if (++targetWrites === 1) return write(fd, Buffer.from(buffer), 0, 3, 0);
        if (targetWrites === 2 || rollbackFails) throw Object.assign(new Error("Disk is full"), { code: "ENOSPC" });
      }
      return write(...args);
    });
    try {
      const result = await resolveConflictFile(repo, "file.txt", "resolved content\n", original);
      expect(result.ok).toBe(false);
      if (modeRestoreFails) expect(result).toMatchObject({ error: expect.stringContaining("Mode restore failed") });
      else if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o444);
      if (rollbackFails) {
        const copies = fs.readdirSync(recoveryRoot);
        expect(copies).toHaveLength(1);
        const recoveryPath = path.join(recoveryRoot, copies[0]!, "original");
        expect(fs.readFileSync(recoveryPath, "utf-8")).toBe(original);
        expect(result).toMatchObject({ error: expect.stringContaining(recoveryPath) });
      } else {
        expect(fs.readFileSync(file, "utf-8")).toBe(original);
        expect(fs.readdirSync(recoveryRoot)).toEqual([]);
      }
    } finally {
      spy.mockRestore();
      chmodSpy.mockRestore();
      tmpdir.mockRestore();
    }
  });

  it("parses ordinary and diff3 markers and resolves one hunk", () => {
    const content =
      "before\n<<<<<<< HEAD\nours\n||||||| base\nbase\n=======\ntheirs\n>>>>>>> branch\nafter\n";
    const hunks = parseConflictHunks(content);
    expect(hunks).toEqual([
      expect.objectContaining({ ours: "ours\n", base: "base\n", theirs: "theirs\n" }),
    ]);
    expect(resolveConflictHunk(content, hunks[0]!, "theirs")).toBe("before\ntheirs\nafter\n");
  });

  it("parses multiple marker blocks and ignores malformed ones", () => {
    const block = (ours: string, theirs: string) =>
      `<<<<<<< HEAD\n${ours}\n=======\n${theirs}\n>>>>>>> branch\n`;
    expect(parseConflictHunks(block("one", "two") + "middle\n" + block("three", "four"))).toHaveLength(2);
    expect(parseConflictHunks("<<<<<<< HEAD\nmissing separator\n>>>>>>> branch\n")).toEqual([]);
  });

  it("reads and resolves Git index stages", async () => {
    const repo = await makeConflictedRepo();

    expect(await readConflictSides(repo, "file.txt")).toMatchObject({
      base: "base\n",
      ours: "ours\n",
      theirs: "theirs\n",
      binary: false,
    });
    expect(await resolveConflictSide(repo, "file.txt", "theirs")).toEqual({ ok: true });
    expect(fs.readFileSync(path.join(repo, "file.txt"), "utf-8")).toBe("theirs\n");
  }, 30_000);

  it.skipIf(process.platform === "win32")("keeps repo status and conflict reads responsive", async () => {
    const repo = await makeConflictedRepo();
    const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-repo-status-"));
    repos.push(wrapperDir);
    const realGit = await assessGitAvailability({ env: gitEnv(), augment: false });
    expect(realGit.runnable && realGit.bin).toBeTruthy();
    fs.writeFileSync(path.join(wrapperDir, "git"), `#!/bin/sh
case "$3" in
  status|show|rev-parse|diff)
  ticket="$TEST_GIT_MARKERS/$3-$$"
  : > "$ticket.start"
  count=0
  while [ ! -e "$ticket.release" ] && [ "$count" -lt 12 ]; do
    /bin/sleep 0.03
    count=$((count + 1))
  done
  if [ ! -e "$ticket.release" ]; then : > "$ticket.timeout"; fi
  ;;
esac
exec "$TEST_GIT_EXECUTABLE" "$@"
`, { mode: 0o755 });

    vi.stubEnv("PATH", `${wrapperDir}${path.delimiter}${process.env.PATH ?? ""}`);
    vi.stubEnv("TEST_GIT_EXECUTABLE", realGit.bin!);
    vi.stubEnv("TEST_GIT_MARKERS", wrapperDir);
    vi.stubEnv("DEVHUB_REPOS_DIR", path.dirname(repo));
    clearGitAvailabilityCache();

    const release = setInterval(() => {
      for (const entry of fs.readdirSync(wrapperDir).filter((file) => file.endsWith(".start"))) {
        fs.writeFileSync(path.join(wrapperDir, `${entry.slice(0, -6)}.release`), "");
      }
    }, 10);
    try {
      const response = await getRepoStatus(new Request("http://localhost/"), {
        params: Promise.resolve({ name: path.basename(repo) }),
      });
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.conflictCount).toBe(1);
      expect(result.files).toEqual(expect.arrayContaining([expect.objectContaining({ path: "file.txt" })]));
      expect(fs.readdirSync(wrapperDir).filter((file) => file.startsWith("status-") && file.endsWith(".start"))).toHaveLength(1);

      const conflictResponse = await getRepoConflicts(new Request("http://localhost/"), {
        params: Promise.resolve({ name: path.basename(repo) }),
      });
      expect(conflictResponse.status).toBe(200);
      const conflictResult = await conflictResponse.json();
      expect(conflictResult.operation).toBe("merge");
      expect(conflictResult.conflicts).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "file.txt", ours: "ours\n", theirs: "theirs\n" }),
      ]));
      const stageResponse = await stageRepoFiles(new Request("http://localhost/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "unstage", path: "file.txt" }),
      }), { params: Promise.resolve({ name: path.basename(repo) }) });
      expect(stageResponse.status).toBe(409);
      expect(await stageResponse.json()).toMatchObject({ code: "unmerged", conflictFiles: ["file.txt"] });
      const markers = fs.readdirSync(wrapperDir);
      expect(markers.filter((file) => file.endsWith(".timeout"))).toEqual([]);
      for (const command of ["status", "show", "rev-parse", "diff"]) {
        expect(markers.some((file) => file.startsWith(`${command}-`) && file.endsWith(".start"))).toBe(true);
      }
    } finally {
      clearInterval(release);
    }
  }, 30_000);

  it.skipIf(process.platform === "win32")("keeps Git status responsive while reporting real conflicts", async () => {
    const repo = await makeConflictedRepo();
    const notePath = path.join(repo, "notes", "daily", "test.json");
    fs.mkdirSync(path.dirname(notePath), { recursive: true });
    fs.writeFileSync(notePath, "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n");

    const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-git-wrapper-"));
    repos.push(wrapperDir);
    const realGit = await assessGitAvailability({ env: gitEnv(), augment: false });
    expect(realGit.runnable && realGit.bin).toBeTruthy();
    fs.writeFileSync(path.join(wrapperDir, "git"), `#!/bin/sh
case "$3" in
  rev-parse|status|log|rev-list)
    ticket="$TEST_GIT_MARKERS/$3-$$"
    : > "$ticket.start"
    count=0
    while [ ! -e "$ticket.release" ] && [ "$count" -lt 30 ]; do
      /bin/sleep 0.05
      count=$((count + 1))
    done
    if [ ! -e "$ticket.release" ]; then : > "$ticket.timeout"; fi
    ;;
esac
exec "$TEST_GIT_EXECUTABLE" "$@"
`, { mode: 0o755 });

    vi.stubEnv("PATH", `${wrapperDir}${path.delimiter}${process.env.PATH ?? ""}`);
    vi.stubEnv("TEST_GIT_EXECUTABLE", realGit.bin!);
    vi.stubEnv("TEST_GIT_MARKERS", wrapperDir);
    vi.stubEnv("REPO_ROOT", repo);
    clearGitAvailabilityCache();

    let finished = false;
    const request = GET(new Request("http://localhost/api/status/git"));
    void request.then(() => { finished = true; }, () => { finished = true; });
    const deadline = Date.now() + 25_000;
    while (!finished && Date.now() < deadline) {
      for (const entry of fs.readdirSync(wrapperDir).filter((file) => file.endsWith(".start"))) {
        fs.writeFileSync(path.join(wrapperDir, `${entry.slice(0, -6)}.release`), "");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(finished).toBe(true);
    const response = await request;
    expect(response.status).toBe(200);
    const markers = fs.readdirSync(wrapperDir);
    expect(markers.filter((file) => file.endsWith(".timeout"))).toEqual([]);
    for (const command of ["rev-parse", "status", "log", "rev-list"]) {
      expect(markers.some((file) => file.startsWith(`${command}-`) && file.endsWith(".start"))).toBe(true);
    }
    const result = await response.json();
    expect(result.conflictFiles).toEqual(expect.arrayContaining(["file.txt", "notes/daily/test.json"]));
  }, 30_000);
});
