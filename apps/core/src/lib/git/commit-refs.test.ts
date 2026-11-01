import { describe, expect, it } from "vitest";
import { parseCommitRefs } from "./commit-refs";

describe("parseCommitRefs", () => {
  it("reads a squash-merge PR number", () => {
    expect(parseCommitRefs("Fix flaky search tests (#553)").prNumbers).toEqual([553]);
  });

  it("reads ticket ids", () => {
    expect(parseCommitRefs("ABC-123 - Update cache policy").tickets).toEqual([
      "ABC-123",
    ]);
    expect(parseCommitRefs("XYZ-456: Support grouped questions").tickets).toEqual(["XYZ-456"]);
  });

  it("reads both from one subject", () => {
    const refs = parseCommitRefs("ABC-789 - Add search endpoint (#549)");
    expect(refs).toEqual({ prNumbers: [549], tickets: ["ABC-789"] });
  });

  it("does not invent tickets from ordinary hyphenated words", () => {
    const refs = parseCommitRefs("chore: bump read-next-2 and follow-up-3 deps");
    expect(refs.tickets).toEqual([]);
  });

  it("ignores encoding and standards names that look like tickets", () => {
    expect(parseCommitRefs("fix: decode UTF-8 and hash with SHA-256").tickets).toEqual([]);
  });

  it("ignores lowercase look-alikes", () => {
    expect(parseCommitRefs("fix: the abc-123 helper").tickets).toEqual([]);
  });

  it("dedupes repeated references", () => {
    const refs = parseCommitRefs("ABC-1 follow-up to ABC-1 (#9) supersedes #9");
    expect(refs.tickets).toEqual(["ABC-1"]);
    expect(refs.prNumbers).toEqual([9]);
  });

  it("does not read a bare number as a PR", () => {
    expect(parseCommitRefs("bump to version 553").prNumbers).toEqual([]);
  });

  it("does not treat an issue-style #N inside a word as a PR", () => {
    expect(parseCommitRefs("colour is #553aa1 now").prNumbers).toEqual([]);
  });

  it("survives empty and junk input", () => {
    expect(parseCommitRefs("")).toEqual({ prNumbers: [], tickets: [] });
    expect(parseCommitRefs("   ")).toEqual({ prNumbers: [], tickets: [] });
  });
});
