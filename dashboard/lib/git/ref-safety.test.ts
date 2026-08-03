import { describe, expect, it } from "vitest";
import { isSafeCommitRef, isSafeRepoRelPath } from "./ref-safety";

describe("isSafeCommitRef", () => {
  it("accepts short and full SHAs", () => {
    expect(isSafeCommitRef("abc1234")).toBe(true);
    expect(isSafeCommitRef("a".repeat(40))).toBe(true);
  });

  it("accepts parent walks — 'Blame previous' sends `<sha>^`", () => {
    // The regression this module exists for: open-at-revision used to reject
    // these, so "Open with → Cursor" failed after drilling back one revision.
    expect(isSafeCommitRef("abc1234^")).toBe(true);
    expect(isSafeCommitRef("abc1234~1")).toBe(true);
    expect(isSafeCommitRef("abc1234^^")).toBe(true);
    expect(isSafeCommitRef("HEAD")).toBe(true);
    expect(isSafeCommitRef("HEAD~2")).toBe(true);
  });

  it("rejects ranges, whitespace, branch names and oversized refs", () => {
    expect(isSafeCommitRef("abc1234..def5678")).toBe(false);
    expect(isSafeCommitRef("abc1234 --upload-pack=evil")).toBe(false);
    expect(isSafeCommitRef("main")).toBe(false);
    expect(isSafeCommitRef("")).toBe(false);
    expect(isSafeCommitRef("abc")).toBe(false);
    expect(isSafeCommitRef("a".repeat(129))).toBe(false);
    expect(isSafeCommitRef("abc1234\0")).toBe(false);
  });
});

describe("isSafeRepoRelPath", () => {
  it("accepts ordinary repo-relative paths", () => {
    expect(isSafeRepoRelPath("src/x.ts")).toBe(true);
    expect(isSafeRepoRelPath("a/b/c.tsx")).toBe(true);
  });

  it("accepts dots inside a filename", () => {
    // `includes("..")` used to reject these outright.
    expect(isSafeRepoRelPath("notes/report..final.md")).toBe(true);
  });

  it("rejects traversal and absolute paths", () => {
    expect(isSafeRepoRelPath("../etc/passwd")).toBe(false);
    expect(isSafeRepoRelPath("src/../../etc/passwd")).toBe(false);
    expect(isSafeRepoRelPath("..\\windows\\system32")).toBe(false);
    expect(isSafeRepoRelPath("/etc/passwd")).toBe(false);
    expect(isSafeRepoRelPath("C:\\Windows")).toBe(false);
    expect(isSafeRepoRelPath("")).toBe(false);
    expect(isSafeRepoRelPath("src/x\0.ts")).toBe(false);
  });
});
