import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as stageRepoFiles } from "../../http/routes/repos/[name]/git/stage/route";
import { discardGitPaths } from "./discard";
import { runGitRepo } from "./repo-local";

async function mkTempRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-git-discard-"));
  await runGitRepo(dir, ["init", "-b", "main"]);
  await runGitRepo(dir, ["config", "user.email", "test@example.com"]);
  await runGitRepo(dir, ["config", "user.name", "Test"]);
  await runGitRepo(dir, ["config", "commit.gpgsign", "false"]);
  return dir;
}

function write(repo: string, rel: string, content: string) {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

async function setIndexBlob(repo: string, rel: string, content: string) {
  const tmp = path.join(repo, `.index-tmp-${Date.now()}`);
  fs.writeFileSync(tmp, content);
  const hashed = await runGitRepo(repo, ["hash-object", "-w", tmp]);
  fs.unlinkSync(tmp);
  const oid = hashed.stdout.trim();
  await runGitRepo(repo, ["update-index", "--cacheinfo", `100644,${oid},${rel}`]);
}

const repos: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const dir of repos.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("discardGitPaths", () => {
  it("discards staged edits while keeping non-overlapping unstaged edits", async () => {
    const repo = await mkTempRepo();
    repos.push(repo);
    write(repo, "file.txt", "line1\nline2\nline3\nline4\nline5\nline6\nline7\n");
    await runGitRepo(repo, ["add", "file.txt"]);
    await runGitRepo(repo, ["commit", "-m", "init"]);

    write(repo, "file.txt", "line1\nSTAGED\nline3\nline4\nline5\nline6\nline7\n");
    await runGitRepo(repo, ["add", "file.txt"]);
    write(repo, "file.txt", "line1\nSTAGED\nline3\nline4\nline5\nUNSTAGED\nline7\n");

    expect((await runGitRepo(repo, ["status", "--porcelain"])).stdout.trim()).toBe("MM file.txt");

    vi.stubEnv("DEVHUB_REPOS_DIR", path.dirname(repo));
    const response = await stageRepoFiles(new Request("http://localhost/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "discard", path: "file.txt" }),
    }), { params: Promise.resolve({ name: path.basename(repo) }) });
    expect(response.status).toBe(400);
    expect(fs.readFileSync(path.join(repo, "file.txt"), "utf-8")).toBe("line1\nSTAGED\nline3\nline4\nline5\nUNSTAGED\nline7\n");

    const result = await discardGitPaths(repo, ["file.txt"], "staged");
    expect(result.ok).toBe(true);

    const content = fs.readFileSync(path.join(repo, "file.txt"), "utf-8");
    expect(content).toBe("line1\nline2\nline3\nline4\nline5\nUNSTAGED\nline7\n");
    // Don't .trim() porcelain — leading space marks unstaged-only.
    expect((await runGitRepo(repo, ["status", "--porcelain"])).stdout.replace(/\n$/, "")).toBe(" M file.txt");
    expect((await runGitRepo(repo, ["diff", "--cached"])).stdout.trim()).toBe("");
  });

  it("discards unstaged only, keeping staged hunks", async () => {
    const repo = await mkTempRepo();
    repos.push(repo);
    write(repo, "file.txt", "a\nb\nc\n");
    await runGitRepo(repo, ["add", "file.txt"]);
    await runGitRepo(repo, ["commit", "-m", "init"]);

    await setIndexBlob(repo, "file.txt", "a\nSTAGED\nc\n");
    write(repo, "file.txt", "a\nSTAGED\nUNSTAGED\n");

    const result = await discardGitPaths(repo, ["file.txt"], "unstaged");
    expect(result.ok).toBe(true);

    const content = fs.readFileSync(path.join(repo, "file.txt"), "utf-8");
    expect(content).toBe("a\nSTAGED\nc\n");
    expect((await runGitRepo(repo, ["status", "--porcelain"])).stdout.trim()).toBe("M  file.txt");
  });

  it("fully discards a staged-only file", async () => {
    const repo = await mkTempRepo();
    repos.push(repo);
    write(repo, "file.txt", "orig\n");
    await runGitRepo(repo, ["add", "file.txt"]);
    await runGitRepo(repo, ["commit", "-m", "init"]);
    write(repo, "file.txt", "staged-only\n");
    await runGitRepo(repo, ["add", "file.txt"]);

    const result = await discardGitPaths(repo, ["file.txt"], "staged");
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(repo, "file.txt"), "utf-8")).toBe("orig\n");
    expect((await runGitRepo(repo, ["status", "--porcelain"])).stdout).toBe("");
  });

  it("refuses staged-only discard when an editor saves after the clean check", async () => {
    const repo = await mkTempRepo();
    repos.push(repo);
    write(repo, "file.txt", "original\n");
    await runGitRepo(repo, ["add", "file.txt"]);
    await runGitRepo(repo, ["commit", "-m", "init"]);
    write(repo, "file.txt", "staged\n");
    await runGitRepo(repo, ["add", "file.txt"]);
    const before = (await runGitRepo(repo, ["diff", "--cached"])).stdout;
    const file = path.join(repo, "file.txt");
    const lstat = fs.lstatSync.bind(fs);
    let saved = false;
    vi.spyOn(fs, "lstatSync").mockImplementation(((filePath, options) => {
      const stat = lstat(filePath, options);
      if (filePath === file && !saved) {
        saved = true;
        write(repo, "file.txt", "new work\n");
      }
      return stat;
    }) as typeof fs.lstatSync);

    expect(await discardGitPaths(repo, ["file.txt"], "staged")).toMatchObject({ ok: false, conflict: true });
    expect(saved).toBe(true);
    expect(fs.readFileSync(file, "utf-8")).toBe("new work\n");
    expect((await runGitRepo(repo, ["diff", "--cached"])).stdout).toBe(before);
  });

  it("removes untracked on unstaged discard", async () => {
    const repo = await mkTempRepo();
    repos.push(repo);
    await runGitRepo(repo, ["commit", "--allow-empty", "-m", "init"]);
    write(repo, "junk.txt", "x\n");

    const result = await discardGitPaths(repo, ["junk.txt"], "unstaged");
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(repo, "junk.txt"))).toBe(false);
  });

  it.each([true, false])("treats discard filenames literally (tracked: %s)", async (tracked) => {
    const repo = await mkTempRepo();
    repos.push(repo);
    if (tracked) {
      write(repo, "*.txt", "original\n");
      write(repo, "other.txt", "original\n");
      await runGitRepo(repo, ["add", "."]);
      await runGitRepo(repo, ["commit", "-m", "init"]);
    }
    write(repo, "*.txt", "discard this\n");
    write(repo, "other.txt", "keep this\n");

    expect((await discardGitPaths(repo, ["*.txt"], "unstaged")).ok).toBe(true);
    expect(fs.readFileSync(path.join(repo, "other.txt"), "utf-8")).toBe("keep this\n");
    if (tracked) expect(fs.readFileSync(path.join(repo, "*.txt"), "utf-8")).toBe("original\n");
    else expect(fs.existsSync(path.join(repo, "*.txt"))).toBe(false);
  });

  it("discards a staged new file before the first commit", async () => {
    const repo = await mkTempRepo();
    repos.push(repo);
    write(repo, "new.txt", "hello\n");
    await runGitRepo(repo, ["add", "new.txt"]);

    const result = await discardGitPaths(repo, ["new.txt"], "staged");
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(repo, "new.txt"))).toBe(false);
    expect((await runGitRepo(repo, ["diff", "--cached"])).stdout).toBe("");
  });

  it("restores a staged deletion without overwriting a recreated file", async () => {
    const repo = await mkTempRepo();
    repos.push(repo);
    write(repo, "file.txt", "original\n");
    await runGitRepo(repo, ["add", "file.txt"]);
    await runGitRepo(repo, ["commit", "-m", "init"]);
    await runGitRepo(repo, ["rm", "file.txt"]);
    write(repo, "file.txt", "new work\n");

    const before = (await runGitRepo(repo, ["diff", "--cached"])).stdout;
    expect(await discardGitPaths(repo, ["file.txt"], "staged")).toMatchObject({ ok: false, conflict: true });
    expect(fs.readFileSync(path.join(repo, "file.txt"), "utf-8")).toBe("new work\n");
    expect((await runGitRepo(repo, ["diff", "--cached"])).stdout).toBe(before);

    fs.unlinkSync(path.join(repo, "file.txt"));
    expect((await discardGitPaths(repo, ["file.txt"], "staged")).ok).toBe(true);
    expect(fs.readFileSync(path.join(repo, "file.txt"), "utf-8")).toBe("original\n");
    expect((await runGitRepo(repo, ["status", "--porcelain"])).stdout).toBe("");
  });

  it("refuses a staged addition with unstaged edits", async () => {
    const repo = await mkTempRepo();
    repos.push(repo);
    write(repo, "new.txt", "staged\n");
    await runGitRepo(repo, ["add", "new.txt"]);
    write(repo, "new.txt", "unstaged\n");
    const before = (await runGitRepo(repo, ["ls-files", "--stage"])).stdout;

    expect(await discardGitPaths(repo, ["new.txt"], "staged")).toMatchObject({ ok: false, conflict: true });
    expect(fs.readFileSync(path.join(repo, "new.txt"), "utf-8")).toBe("unstaged\n");
    expect((await runGitRepo(repo, ["ls-files", "--stage"])).stdout).toBe(before);
  });

  it("discards both sides of a staged rename", async () => {
    const repo = await mkTempRepo();
    repos.push(repo);
    const oldPath = "old → name.txt";
    const newPath = "new -> name ü.txt";
    write(repo, oldPath, "original\n");
    await runGitRepo(repo, ["add", oldPath]);
    await runGitRepo(repo, ["commit", "-m", "init"]);
    await runGitRepo(repo, ["mv", oldPath, newPath]);

    const result = await discardGitPaths(repo, [newPath], "staged");

    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(repo, oldPath), "utf-8")).toBe("original\n");
    expect(fs.existsSync(path.join(repo, newPath))).toBe(false);
    expect((await runGitRepo(repo, ["diff", "--cached"])).stdout).toBe("");
  });

  it("discards a clean staged submodule without overwriting hidden local files", async () => {
    const source = await mkTempRepo();
    const repo = await mkTempRepo();
    repos.push(source, repo);
    write(source, ".gitignore", "private.tmp\n");
    write(source, "file.txt", "original\n");
    await runGitRepo(source, ["add", "."]);
    await runGitRepo(source, ["commit", "-m", "init"]);
    await runGitRepo(repo, ["-c", "protocol.file.allow=always", "submodule", "add", source, "module"]);
    await runGitRepo(repo, ["commit", "-m", "init"]);
    const original = (await runGitRepo(path.join(repo, "module"), ["rev-parse", "HEAD"])).stdout;
    write(source, "file.txt", "new\n");
    await runGitRepo(source, ["add", "file.txt"]);
    await runGitRepo(source, ["commit", "-m", "new"]);
    await runGitRepo(path.join(repo, "module"), ["-c", "protocol.file.allow=always", "fetch", "origin"]);
    await runGitRepo(path.join(repo, "module"), ["checkout", "origin/main"]);
    await runGitRepo(repo, ["add", "module"]);
    await runGitRepo(repo, ["config", "submodule.module.ignore", "all"]);
    write(repo, "module/private.tmp", "local work\n");

    expect(await discardGitPaths(repo, ["module"], "staged")).toMatchObject({ ok: false, conflict: true });
    expect(fs.readFileSync(path.join(repo, "module/private.tmp"), "utf-8")).toBe("local work\n");
    fs.unlinkSync(path.join(repo, "module/private.tmp"));
    expect((await discardGitPaths(repo, ["module"], "staged")).ok).toBe(true);
    expect((await runGitRepo(path.join(repo, "module"), ["rev-parse", "HEAD"])).stdout).toBe(original);
    expect((await runGitRepo(repo, ["status", "--porcelain"])).stdout).toBe("");
  });

  it("refuses a staged rename with unstaged edits", async () => {
    const repo = await mkTempRepo();
    repos.push(repo);
    write(repo, "old.txt", "line1\nline2\nline3\n");
    await runGitRepo(repo, ["add", "old.txt"]);
    await runGitRepo(repo, ["commit", "-m", "init"]);
    await runGitRepo(repo, ["mv", "old.txt", "new.txt"]);
    write(repo, "new.txt", "line1\nchanged\nline3\n");

    const before = (await runGitRepo(repo, ["diff", "--cached"])).stdout;
    const result = await discardGitPaths(repo, ["new.txt"], "staged");

    expect(result).toMatchObject({ ok: false, conflict: true });
    expect(fs.readFileSync(path.join(repo, "new.txt"), "utf-8")).toBe(
      "line1\nchanged\nline3\n",
    );
    expect(fs.existsSync(path.join(repo, "old.txt"))).toBe(false);
    expect((await runGitRepo(repo, ["diff", "--cached"])).stdout).toBe(before);
  });

  it("refuses overlapping staged and unstaged edits without changing either", async () => {
    const repo = await mkTempRepo();
    repos.push(repo);
    write(repo, "file.txt", "original\n");
    await runGitRepo(repo, ["add", "file.txt"]);
    await runGitRepo(repo, ["commit", "-m", "init"]);
    write(repo, "file.txt", "staged\n");
    await runGitRepo(repo, ["add", "file.txt"]);
    write(repo, "file.txt", "unstaged\n");
    const before = (await runGitRepo(repo, ["diff", "--cached"])).stdout;

    vi.stubEnv("DEVHUB_REPOS_DIR", path.dirname(repo));
    const response = await stageRepoFiles(new Request("http://localhost/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "discard", path: "file.txt", scope: "staged" }),
    }), { params: Promise.resolve({ name: path.basename(repo) }) });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("Unstage it, or use Discard all");
    expect(fs.readFileSync(path.join(repo, "file.txt"), "utf-8")).toBe("unstaged\n");
    expect((await runGitRepo(repo, ["diff", "--cached"])).stdout).toBe(before);
  });

  it("refuses mixed binary edits without changing either", async () => {
    const repo = await mkTempRepo();
    repos.push(repo);
    write(repo, "file.bin", "original\0\n");
    await runGitRepo(repo, ["add", "file.bin"]);
    await runGitRepo(repo, ["commit", "-m", "init"]);
    write(repo, "file.bin", "staged\0\n");
    await runGitRepo(repo, ["add", "file.bin"]);
    write(repo, "file.bin", "unstaged\0\n");
    const before = (await runGitRepo(repo, ["ls-files", "--stage"])).stdout;

    expect(await discardGitPaths(repo, ["file.bin"], "staged")).toMatchObject({ ok: false, conflict: true });
    expect(fs.readFileSync(path.join(repo, "file.bin"), "utf-8")).toBe("unstaged\0\n");
    expect((await runGitRepo(repo, ["ls-files", "--stage"])).stdout).toBe(before);
  });

  it("keeps the original worktree if replacement fails after resetting the index", async () => {
    const repo = await mkTempRepo();
    repos.push(repo);
    write(repo, "file.txt", "a\nb\nc\nd\ne\nf\ng\n");
    await runGitRepo(repo, ["add", "file.txt"]);
    await runGitRepo(repo, ["commit", "-m", "init"]);
    write(repo, "file.txt", "a\nSTAGED\nc\nd\ne\nf\ng\n");
    await runGitRepo(repo, ["add", "file.txt"]);
    const worktree = "a\nSTAGED\nc\nd\ne\nUNSTAGED\ng\n";
    write(repo, "file.txt", worktree);
    const rename = fs.renameSync.bind(fs);
    vi.spyOn(fs, "renameSync").mockImplementation((oldPath, newPath) => {
      if (String(oldPath).includes(".devhub-discard-")) throw new Error("rename failed");
      rename(oldPath, newPath);
    });

    expect(await discardGitPaths(repo, ["file.txt"], "staged")).toMatchObject({ ok: false, error: expect.stringContaining("rename failed") });
    expect(fs.readFileSync(path.join(repo, "file.txt"), "utf-8")).toBe(worktree);
    expect((await runGitRepo(repo, ["diff", "--cached"])).stdout).toBe("");
  });

  it("does not overwrite edits made while the index is being reset", async () => {
    const repo = await mkTempRepo();
    repos.push(repo);
    const file = path.join(repo, "file.txt");
    write(repo, "file.txt", "a\nb\nc\nd\ne\nf\ng\n");
    await runGitRepo(repo, ["add", "file.txt"]);
    await runGitRepo(repo, ["commit", "-m", "init"]);
    write(repo, "file.txt", "a\nSTAGED\nc\nd\ne\nf\ng\n");
    await runGitRepo(repo, ["add", "file.txt"]);
    write(repo, "file.txt", "a\nSTAGED\nc\nd\ne\nUNSTAGED\ng\n");
    const lstat = fs.lstatSync.bind(fs);
    let calls = 0;
    vi.spyOn(fs, "lstatSync").mockImplementation(((filePath, options) => {
      if (filePath === file && ++calls === 2) write(repo, "file.txt", "newer work\n");
      return lstat(filePath, options);
    }) as typeof fs.lstatSync);

    expect(await discardGitPaths(repo, ["file.txt"], "staged")).toMatchObject({ ok: false, conflict: true, error: expect.stringContaining("unstaged") });
    expect(fs.readFileSync(file, "utf-8")).toBe("newer work\n");
    expect((await runGitRepo(repo, ["diff", "--cached"])).stdout).toBe("");
  });

  it("keeps CRLF worktree edits when the index uses LF", async () => {
    const repo = await mkTempRepo();
    repos.push(repo);
    write(repo, ".gitattributes", "*.txt text eol=crlf\n");
    write(repo, "file.txt", "a\r\nb\r\nc\r\nd\r\ne\r\nf\r\ng\r\n");
    await runGitRepo(repo, ["add", ".gitattributes", "file.txt"]);
    await runGitRepo(repo, ["commit", "-m", "init"]);
    write(repo, "file.txt", "a\r\nSTAGED\r\nc\r\nd\r\ne\r\nf\r\ng\r\n");
    await runGitRepo(repo, ["add", "file.txt"]);
    write(repo, "file.txt", "a\r\nSTAGED\r\nc\r\nd\r\ne\r\nUNSTAGED\r\ng\r\n");

    expect((await discardGitPaths(repo, ["file.txt"], "staged")).ok).toBe(true);
    expect(fs.readFileSync(path.join(repo, "file.txt"), "utf-8")).toBe("a\r\nb\r\nc\r\nd\r\ne\r\nUNSTAGED\r\ng\r\n");
    expect((await runGitRepo(repo, ["diff", "--cached"])).stdout).toBe("");
  });

  it("rejects staged discard for an unresolved conflict", async () => {
    const repo = await mkTempRepo();
    repos.push(repo);
    write(repo, "file.txt", "base\n");
    await runGitRepo(repo, ["add", "file.txt"]);
    await runGitRepo(repo, ["commit", "-m", "init"]);
    await runGitRepo(repo, ["checkout", "-b", "side"]);
    write(repo, "file.txt", "side\n");
    await runGitRepo(repo, ["add", "file.txt"]);
    await runGitRepo(repo, ["commit", "-m", "side"]);
    await runGitRepo(repo, ["checkout", "main"]);
    write(repo, "file.txt", "main\n");
    await runGitRepo(repo, ["add", "file.txt"]);
    await runGitRepo(repo, ["commit", "-m", "main"]);
    expect((await runGitRepo(repo, ["merge", "side"])).status).not.toBe(0);

    const before = (await runGitRepo(repo, ["ls-files", "-u"])).stdout;
    const result = await discardGitPaths(repo, ["file.txt"], "staged");

    expect(result).toEqual({
      ok: false,
      error: "Resolve the conflict before discarding staged changes",
    });
    expect((await runGitRepo(repo, ["ls-files", "-u"])).stdout).toBe(before);
  });

  it("preserves an unstaged executable-bit change while discarding staged content", async () => {
    const repo = await mkTempRepo();
    repos.push(repo);
    write(repo, "file.txt", "original\n");
    await runGitRepo(repo, ["add", "file.txt"]);
    await runGitRepo(repo, ["commit", "-m", "init"]);
    await setIndexBlob(repo, "file.txt", "staged\n");
    write(repo, "file.txt", "staged\n");
    fs.chmodSync(path.join(repo, "file.txt"), 0o755);

    const result = await discardGitPaths(repo, ["file.txt"], "staged");

    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(repo, "file.txt"), "utf-8")).toBe("original\n");
    expect(fs.statSync(path.join(repo, "file.txt")).mode & 0o111).not.toBe(0);
    expect((await runGitRepo(repo, ["status", "--porcelain=v1"])).stdout).toBe(" M file.txt\n");
  });
  it("removes an untracked directory on unstaged discard", async () => {
    const repo = await mkTempRepo();
    repos.push(repo);
    await runGitRepo(repo, ["commit", "--allow-empty", "-m", "init"]);
    write(repo, "cache/provider/file", "x\n");
    const status = (await runGitRepo(repo, ["status", "--porcelain"])).stdout;
    expect(status).toContain("cache/");
    const result = await discardGitPaths(repo, ["cache/"], "unstaged");
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(repo, "cache"))).toBe(false);
  });

});
