import { describe, expect, it } from "vitest";
import { parseCommitRefs } from "./commit-refs";

describe("parseCommitRefs", () => {
  it("reads a squash-merge PR number", () => {
    expect(parseCommitRefs("Fix flaky Atlas Search E2E tests (#553)").prNumbers).toEqual([553]);
  });

  it("reads ticket ids", () => {
    expect(parseCommitRefs("PTF-4381 - Move read-next cache policy to CAPI").tickets).toEqual([
      "PTF-4381",
    ]);
    expect(parseCommitRefs("DP-6144: Support Categorized Questions").tickets).toEqual(["DP-6144"]);
  });

  it("reads both from one subject", () => {
    const refs = parseCommitRefs("PTF-3851 - Add read next posts endpoint (#549)");
    expect(refs).toEqual({ prNumbers: [549], tickets: ["PTF-3851"] });
  });

  it("does not invent tickets from ordinary hyphenated words", () => {
    const refs = parseCommitRefs("chore: bump read-next-2 and follow-up-3 deps");
    expect(refs.tickets).toEqual([]);
  });

  it("ignores encoding and standards names that look like tickets", () => {
    expect(parseCommitRefs("fix: decode UTF-8 and hash with SHA-256").tickets).toEqual([]);
  });

  it("ignores lowercase look-alikes", () => {
    expect(parseCommitRefs("fix: the ptf-123 helper").tickets).toEqual([]);
  });

  it("dedupes repeated references", () => {
    const refs = parseCommitRefs("PTF-1 follow-up to PTF-1 (#9) supersedes #9");
    expect(refs.tickets).toEqual(["PTF-1"]);
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
