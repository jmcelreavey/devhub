import { describe, expect, it } from "vitest";
import {
  capText,
  formatGitBlame,
  formatGitBranches,
  formatGitDiff,
  formatGitLog,
  formatGitShow,
  formatGitStatus,
} from "./git-format.ts";

describe("capText", () => {
  it("cuts on a line boundary and reports the sizes", () => {
    const text = ["line one", "line two", "line three"].join("\n");
    const out = capText(text, "narrow it", 12);
    expect(out.startsWith("line one\n\n[truncated: showing 8 of 28 chars — narrow it]")).toBe(true);
  });
});

describe("formatGitStatus", () => {
  it("renders porcelain-style lines under a summary", () => {
    const out = formatGitStatus({
      currentBranch: "main",
      upstream: "origin/main",
      files: [
        { path: "a.ts", indexStatus: "M", worktreeStatus: "", staged: true },
        { path: "b.ts", indexStatus: "", worktreeStatus: "M", unstaged: true },
        { path: "c.ts", untracked: true },
      ],
    });
    expect(out).toContain("On main → origin/main: 3 changed (1 staged, 1 unstaged, 1 untracked).");
    expect(out).toContain("M  a.ts\n M b.ts\n?? c.ts");
  });

  it("says clean when there is nothing to report", () => {
    expect(formatGitStatus({ currentBranch: "main", upstream: null, files: [], clean: true })).toBe(
      "On main (no upstream): clean working tree.",
    );
  });
});

describe("formatGitDiff", () => {
  it("returns the raw diff, not the parsed lines copy", () => {
    const raw = "diff --git a/x b/x\n+added";
    expect(formatGitDiff({ kind: "file", raw, empty: false }, "x")).toBe(raw);
  });

  it("names an empty diff", () => {
    expect(formatGitDiff({ kind: "file", raw: "", empty: true }, "x")).toBe("No changes in x.");
  });
});

describe("formatGitLog", () => {
  it("renders one line per commit and a pagination hint", () => {
    const out = formatGitLog({
      commits: [{ shortHash: "abc1234", relativeDate: "2 hours ago", author: "Ada", subject: "fix: thing", refs: ["main"] }],
      hasMore: true,
      nextOffset: 40,
    });
    expect(out).toBe("abc1234 2 hours ago · Ada · fix: thing (main)\n\nMore: pass offset=40.");
  });
});

describe("formatGitShow", () => {
  it("prints header, files and the selected patch", () => {
    const out = formatGitShow({
      hash: "abc",
      subject: "feat: x",
      author: "Ada",
      date: "2026-09-01",
      parents: ["p1"],
      files: [
        { path: "a.ts", status: "M" },
        { path: "b.ts", status: "A" },
      ],
      path: "a.ts",
      raw: "+x",
    });
    expect(out).toContain("commit abc\nAuthor: Ada\nDate:   2026-09-01\n\n    feat: x");
    expect(out).toContain("Files (2):\nM a.ts\nA b.ts");
    expect(out).toContain("Patch for a.ts (pass path for another file):\n+x");
  });
});

describe("formatGitBlame", () => {
  const data = {
    lines: [1, 2, 3].map((n) => ({ hash: "deadbeefcafe", author: "Ada", date: "2026-09-01T00:00", lineNumber: n, content: `l${n}` })),
    history: [{ shortHash: "dead", subject: "init", author: "Ada", relativeDate: "1 day ago" }],
  };

  it("filters to the requested line range", () => {
    const out = formatGitBlame(data, { startLine: 2, endLine: 2 });
    expect(out).toContain("    2| l2");
    expect(out).not.toContain("l1");
    expect(out).toContain("Recent file history:\n- dead 1 day ago · Ada · init");
  });
});

describe("formatGitBranches", () => {
  it("summarises instead of listing every remote branch", () => {
    const out = formatGitBranches({
      currentBranch: "feat",
      upstream: "origin/feat",
      ahead: 2,
      behind: 0,
      branches: [
        { name: "feat", current: true, upstream: "origin/feat", shortHash: "abc", ahead: 2 },
        { name: "old", shortHash: "def", staleDays: 90 },
      ],
      remoteBranches: new Array(500).fill({ name: "origin/x" }),
    });
    expect(out).toContain("* feat abc [→ origin/feat, ↑2]");
    expect(out).toContain("  old def [local only, 90d stale]");
    expect(out).toContain("Remote branches: 500");
    expect(out).not.toContain("origin/x");
  });
});
