import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildHunkPatch,
  parseFileDiff,
  recountHunkHeader,
  stageDiffHunk,
} from "@/lib/git/patch-stage";
import { runGitRepo } from "@/lib/git/repo-local";

const repos: string[] = [];
afterEach(() => {
  for (const dir of repos.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const SAMPLE = `diff --git a/foo.ts b/foo.ts
index 111..222 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,4 +1,5 @@
 line1
-line2
+STAGED
 line3
+EXTRA
 line4
@@ -10,3 +11,3 @@
 keep
-old
+new
`;

describe("parseFileDiff", () => {
  it("splits preamble and hunks", () => {
    const parsed = parseFileDiff(SAMPLE);
    expect(parsed.oldPath).toBe("foo.ts");
    expect(parsed.newPath).toBe("foo.ts");
    expect(parsed.hunks).toHaveLength(2);
    expect(parsed.hunks[0]?.oldStart).toBe(1);
    expect(parsed.hunks[0]?.newCount).toBe(5);
    expect(parsed.hunks[1]?.header).toContain("@@ -10,3 +11,3 @@");
  });
});

describe("buildHunkPatch", () => {
  it("builds a single-hunk patch with file headers", () => {
    const parsed = parseFileDiff(SAMPLE);
    const patch = buildHunkPatch(parsed, 1, "foo.ts");
    expect(patch).toContain("diff --git a/foo.ts b/foo.ts");
    expect(patch).toContain("@@ -10,3 +11,3 @@");
    expect(patch).toContain("-old");
    expect(patch).toContain("+new");
    expect(patch).not.toContain("STAGED");
  });

  it("builds a line-subset patch by demoting unselected deletions to context", () => {
    const parsed = parseFileDiff(SAMPLE);
    const hunk = parsed.hunks[0]!;
    // Select only the +EXTRA line (find index)
    const extraIdx = hunk.lines.findIndex((l) => l === "+EXTRA");
    expect(extraIdx).toBeGreaterThan(0);
    const patch = buildHunkPatch(parsed, 0, "foo.ts", [extraIdx]);
    expect(patch).toContain("+EXTRA");
    expect(patch).not.toContain("+STAGED");
    // unselected deletion becomes context
    expect(patch).toContain(" line2");
    expect(patch).not.toMatch(/^-line2$/m);
  });
});

describe("recountHunkHeader", () => {
  it("counts add/del/context", () => {
    expect(recountHunkHeader([" ctx", "-old", "+new"], 3, 3)).toBe("@@ -3,2 +3,2 @@");
    expect(recountHunkHeader(["+only"], 1, 1)).toBe("@@ -1,0 +1 @@");
  });
});

describe("stageDiffHunk", () => {
  it("stages one hunk via apply --cached", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-patch-stage-"));
    repos.push(repo);
    runGitRepo(repo, ["init", "-b", "main"]);
    runGitRepo(repo, ["config", "user.email", "t@t.com"]);
    runGitRepo(repo, ["config", "user.name", "T"]);
    runGitRepo(repo, ["config", "commit.gpgsign", "false"]);
    fs.writeFileSync(path.join(repo, "a.txt"), "one\ntwo\nthree\nfour\n");
    runGitRepo(repo, ["add", "a.txt"]);
    runGitRepo(repo, ["commit", "-m", "init"]);
    fs.writeFileSync(path.join(repo, "a.txt"), "one\nTWO\nthree\nFOUR\n");
    const raw = runGitRepo(repo, ["diff", "--", "a.txt"]).stdout;
    const parsed = parseFileDiff(raw);
    expect(parsed.hunks.length).toBeGreaterThanOrEqual(1);

    const result = await stageDiffHunk({
      repoRoot: repo,
      rawDiff: raw,
      filePath: "a.txt",
      hunkIndex: 0,
      reverse: false,
    });
    expect(result.ok).toBe(true);
    const cached = runGitRepo(repo, ["diff", "--cached", "--", "a.txt"]).stdout;
    expect(cached).toContain("TWO");
  });

  /** A repo with two independent edits inside a single hunk. */
  function mixedRepo(): string {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-line-stage-"));
    repos.push(repo);
    runGitRepo(repo, ["init", "-b", "main"]);
    runGitRepo(repo, ["config", "user.email", "t@t.com"]);
    runGitRepo(repo, ["config", "user.name", "T"]);
    runGitRepo(repo, ["config", "commit.gpgsign", "false"]);
    fs.writeFileSync(path.join(repo, "a.txt"), "one\ntwo\nthree\nfour\nfive\n");
    runGitRepo(repo, ["add", "a.txt"]);
    runGitRepo(repo, ["commit", "-m", "init"]);
    fs.writeFileSync(path.join(repo, "a.txt"), "one\nTWO\nthree\nFOUR\nfive\n");
    return repo;
  }

  /** Hunk-body indexes of the change lines matching `pattern`. */
  function pick(raw: string, hunkIndex: number, pattern: RegExp): number[] {
    const hunk = parseFileDiff(raw).hunks[hunkIndex]!;
    return hunk.lines.flatMap((line, i) => (i > 0 && pattern.test(line) ? [i] : []));
  }

  it("stages only the selected lines, leaving the rest of the hunk unstaged", async () => {
    // The case hunk-level staging cannot express, and the reason `git add -p`
    // still gets reached for.
    const repo = mixedRepo();
    const raw = runGitRepo(repo, ["diff", "--", "a.txt"]).stdout;

    const result = await stageDiffHunk({
      repoRoot: repo,
      rawDiff: raw,
      filePath: "a.txt",
      hunkIndex: 0,
      lineIndexes: pick(raw, 0, /^[-+](two|TWO)$/),
      reverse: false,
    });

    expect(result.ok).toBe(true);
    const cached = runGitRepo(repo, ["diff", "--cached", "--", "a.txt"]).stdout;
    expect(cached).toContain("+TWO");
    expect(cached).not.toContain("FOUR");
    // The unselected edit survives in the working tree.
    expect(runGitRepo(repo, ["diff", "--", "a.txt"]).stdout).toContain("+FOUR");
  });

  it("unstages only the selected lines", async () => {
    // Regression: buildHunkPatch never saw `reverse`, so on an unstage it kept
    // unselected deletions as context and dropped unselected additions — the
    // exact opposite of what a reverse-applied patch needs. The apply either
    // failed outright or unstaged a line the user had not picked.
    const repo = mixedRepo();
    const raw = runGitRepo(repo, ["diff", "--", "a.txt"]).stdout;
    await stageDiffHunk({
      repoRoot: repo,
      rawDiff: raw,
      filePath: "a.txt",
      hunkIndex: 0,
      reverse: false,
    });

    const staged = runGitRepo(repo, ["diff", "--cached", "--", "a.txt"]).stdout;
    const result = await stageDiffHunk({
      repoRoot: repo,
      rawDiff: staged,
      filePath: "a.txt",
      hunkIndex: 0,
      lineIndexes: pick(staged, 0, /^[-+](two|TWO)$/),
      reverse: true,
    });

    expect(result.ok).toBe(true);
    const afterCached = runGitRepo(repo, ["diff", "--cached", "--", "a.txt"]).stdout;
    // TWO came back out of the index; FOUR stayed in.
    expect(afterCached).not.toContain("TWO");
    expect(afterCached).toContain("+FOUR");
    // Nothing was lost from the working tree by the round trip.
    expect(fs.readFileSync(path.join(repo, "a.txt"), "utf-8")).toBe("one\nTWO\nthree\nFOUR\nfive\n");
  });
});

describe("buildHunkPatch line selection", () => {
  const parsed = parseFileDiff(SAMPLE);

  it("demotes an unselected deletion to context when staging", () => {
    // It is still in the index, so the patch has to say it is there.
    const patch = buildHunkPatch(parsed, 0, "foo.ts", [4], false)!;
    expect(patch).toContain(" line2");
    expect(patch).not.toMatch(/^-line2$/m);
  });

  it("demotes an unselected addition to context when unstaging", () => {
    // Reversed: the staged addition is in the index, so it must be represented,
    // and the staged deletion is already gone, so it must not be.
    const patch = buildHunkPatch(parsed, 0, "foo.ts", [4], true)!;
    expect(patch).toContain(" STAGED");
    expect(patch).not.toMatch(/^-line2$/m);
    expect(patch).not.toMatch(/^\+STAGED$/m);
  });
});
