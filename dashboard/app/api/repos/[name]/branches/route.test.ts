import { describe, expect, it } from "vitest";
import { parseChangedFiles, parseLeftRightCount, parseUnpushedCommits } from "./parsers";

describe("repo branch route parsers", () => {
  it("parses changed files from porcelain status", () => {
    expect(parseChangedFiles(" M dashboard/app/repos/cards.tsx\n?? new file.txt\n")).toEqual([
      { status: "M", path: "dashboard/app/repos/cards.tsx" },
      { status: "??", path: "new file.txt" },
    ]);
  });

  it("parses unpushed commits with full + short hash", () => {
    expect(
      parseUnpushedCommits(
        "\u001eaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\u0000abc1234\u0000add repo actions\nfile-a.ts\nfile-b.ts\n",
      ),
    ).toEqual([
      {
        hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        shortHash: "abc1234",
        subject: "add repo actions",
        files: ["file-a.ts", "file-b.ts"],
      },
    ]);
  });

  it("parses legacy short-hash unpushed format", () => {
    expect(parseUnpushedCommits("\u001eabc123\u0000add repo actions\nfile-a.ts\n")).toEqual([
      { hash: "abc123", shortHash: "abc123", subject: "add repo actions", files: ["file-a.ts"] },
    ]);
  });

  it("parses left-right rev-list counts", () => {
    expect(parseLeftRightCount("2\t5\n")).toEqual({ left: 2, right: 5 });
    expect(parseLeftRightCount("0 1")).toEqual({ left: 0, right: 1 });
  });
});
