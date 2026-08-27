import { describe, expect, it } from "vitest";
import { partitionRepoOpenPrs } from "./partition-repo-prs";

function pr(url: string, login?: string) {
  return { url, ...(login ? { author: { login } } : {}) };
}

describe("partitionRepoOpenPrs", () => {
  it("puts authored URLs first and leaves the rest collapsed-ready", () => {
    const { mine, others } = partitionRepoOpenPrs(
      [pr("https://github.com/o/r/pull/1", "ada"), pr("https://github.com/o/r/pull/2", "bot")],
      [pr("https://github.com/o/r/pull/1", "ada")],
    );
    expect(mine.map((row) => row.url)).toEqual(["https://github.com/o/r/pull/1"]);
    expect(others.map((row) => row.url)).toEqual(["https://github.com/o/r/pull/2"]);
  });

  it("treats the same GitHub login as mine when the URL is missing from authored", () => {
    const { mine, others } = partitionRepoOpenPrs(
      [pr("https://github.com/o/r/pull/9", "Ada")],
      [pr("https://github.com/o/other/pull/1", "ada")],
    );
    expect(mine).toHaveLength(1);
    expect(others).toHaveLength(0);
  });

  it("sends everything to others when authored is empty", () => {
    const { mine, others } = partitionRepoOpenPrs([pr("https://github.com/o/r/pull/1", "ada")], []);
    expect(mine).toHaveLength(0);
    expect(others).toHaveLength(1);
  });

  it("does not invent an owner from author-less rows", () => {
    const { mine, others } = partitionRepoOpenPrs([pr("https://github.com/o/r/pull/1")], []);
    expect(mine).toHaveLength(0);
    expect(others).toHaveLength(1);
  });
});
