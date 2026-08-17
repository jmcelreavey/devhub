import { describe, expect, it } from "vitest";
import {
  fileStatusGlyph,
  isGitNoisePath,
  parseBlamePorcelain,
  parseFileHistory,
  parseGraphLog,
  parsePorcelainStatus,
  parseStashList,
  parseUnifiedContext,
  parseUnifiedDiff,
  parseNameStatus,
} from "@/lib/repos/git-parsers";
import { layoutCommitGraph, laneColor } from "@/lib/repos/git-graph";

describe("parsePorcelainStatus", () => {
  it("splits staged, unstaged, and untracked", () => {
    const rows = parsePorcelainStatus("M  staged.ts\n M dirty.ts\nMM both.ts\n?? new.ts\n");
    expect(rows).toEqual([
      {
        path: "staged.ts",
        indexStatus: "M",
        worktreeStatus: "",
        staged: true,
        unstaged: false,
        untracked: false,
      },
      {
        path: "dirty.ts",
        indexStatus: "",
        worktreeStatus: "M",
        staged: false,
        unstaged: true,
        untracked: false,
      },
      {
        path: "both.ts",
        indexStatus: "M",
        worktreeStatus: "M",
        staged: true,
        unstaged: true,
        untracked: false,
      },
      {
        path: "new.ts",
        indexStatus: "?",
        worktreeStatus: "?",
        staged: false,
        unstaged: true,
        untracked: true,
      },
    ]);
  });

  it("preserves NUL-delimited rename paths without interpreting their contents", () => {
    const rows = parsePorcelainStatus(
      "R  new → name -> literal.ts\0old ü name.ts\0?? line\nbreak.txt\0",
    );

    expect(rows[0]).toMatchObject({
      path: "new → name -> literal.ts",
      originalPath: "old ü name.ts",
      indexStatus: "R",
    });
    expect(rows[1]?.path).toBe("line\nbreak.txt");
  });
});

describe("isGitNoisePath", () => {
  it("flags DS_Store and pycache clutter", () => {
    expect(isGitNoisePath(".DS_Store")).toBe(true);
    expect(isGitNoisePath("foo/.DS_Store")).toBe(true);
    expect(isGitNoisePath("__pycache__/x.pyc")).toBe(true);
    expect(isGitNoisePath("mod.pyc")).toBe(true);
    expect(isGitNoisePath("src/app.ts")).toBe(false);
  });
});

describe("parseStashList", () => {
  it("parses WIP and named stashes", () => {
    expect(
      parseStashList("stash@{0}\0WIP on main: abc subject\nstash@{1}\0On feature: my save\n"),
    ).toEqual([
      {
        ref: "stash@{0}",
        index: 0,
        branch: "main",
        message: "abc subject",
        detail: "WIP on main: abc subject",
      },
      {
        ref: "stash@{1}",
        index: 1,
        branch: "feature",
        message: "my save",
        detail: "On feature: my save",
      },
    ]);
  });
});

describe("parseGraphLog + layout", () => {
  it("parses commits and assigns lanes", () => {
    const commits = parseGraphLog(
      "\u001ea1\u0000b1\u0000a1short\u0000tip\u0000me\u00002 hours ago\u0000HEAD -> main, origin/main\u001eb1\u0000\u0000b1short\u0000root\u0000me\u00001 day ago\u0000",
    );
    expect(commits).toHaveLength(2);
    expect(commits[0]?.refs).toContain("main");
    // "HEAD -> main" used to be flattened away; the decoration is now readable.
    expect(commits[0]?.isHead).toBe(true);
    expect(commits[0]?.headBranch).toBe("main");
    expect(commits[0]?.refs).not.toContain("HEAD");
    expect(commits[1]?.isHead).toBe(false);
    const layout = layoutCommitGraph(commits);
    expect(layout[0]?.lane).toBe(0);
    expect(layout[0]?.parentLanes[0]?.lane).toBe(0);
    expect(laneColor(0)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("parseBlamePorcelain", () => {
  it("reads line content and metadata", () => {
    const blame = parseBlamePorcelain(
      [
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1",
        "author Ada",
        "author-time 1700000000",
        "\tconst x = 1;",
      ].join("\n"),
    );
    expect(blame).toHaveLength(1);
    expect(blame[0]).toMatchObject({
      hash: "aaaaaaa",
      author: "Ada",
      lineNumber: 1,
      content: "const x = 1;",
    });
    expect(blame[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("parseFileHistory", () => {
  it("parses history rows", () => {
    expect(parseFileHistory("\u001efull\u0000short\u0000msg\u0000Ann\u00002 days ago\n")).toEqual([
      { hash: "full", shortHash: "short", subject: "msg", author: "Ann", relativeDate: "2 days ago" },
    ]);
  });
});

describe("parseUnifiedDiff + glyph", () => {
  it("classifies diff lines", () => {
    const lines = parseUnifiedDiff("diff --git a/f b/f\n@@ -1 +1 @@\n-old\n+new\n ctx");
    expect(lines.map((l) => l.type)).toEqual(["meta", "hunk", "del", "add", "ctx"]);
  });

  it("builds status glyph", () => {
    expect(fileStatusGlyph({ path: "a", indexStatus: "M", worktreeStatus: "M", staged: true, unstaged: true, untracked: false })).toBe("MM");
    expect(fileStatusGlyph({ path: "a", indexStatus: "?", worktreeStatus: "?", staged: false, unstaged: true, untracked: true })).toBe("??");
  });
});

describe("parseUnifiedContext", () => {
  it("defaults to 3, full to a huge window, and clamps junk", () => {
    expect(parseUnifiedContext(null, false)).toBe(3);
    expect(parseUnifiedContext("", false)).toBe(3);
    expect(parseUnifiedContext("nope", false)).toBe(3);
    expect(parseUnifiedContext("12", false)).toBe(12);
    expect(parseUnifiedContext("-4", false)).toBe(0);
    expect(parseUnifiedContext("3", true)).toBe(999_999);
  });
});

describe("parseNameStatus", () => {
  it("keeps the new path for renames", () => {
    expect(parseNameStatus("M\tsrc/a.ts\nR100\told.ts\tnew.ts\n")).toEqual([
      { status: "M", path: "src/a.ts" },
      { status: "R100", path: "new.ts" },
    ]);
  });
});
