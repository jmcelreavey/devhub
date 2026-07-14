import { describe, expect, it } from "vitest";
import { parseChangedFiles, parseUnpushedCommits } from "./parsers";

describe("repo branch route parsers", () => {
  it("parses changed files from porcelain status", () => {
    expect(parseChangedFiles(" M dashboard/app/repos/cards.tsx\n?? new file.txt\n")).toEqual([
      { status: "M", path: "dashboard/app/repos/cards.tsx" },
      { status: "??", path: "new file.txt" },
    ]);
  });

  it("parses unpushed commits with changed files", () => {
    expect(parseUnpushedCommits("\u001eabc123\u0000add repo actions\nfile-a.ts\nfile-b.ts\n")).toEqual([
      { hash: "abc123", subject: "add repo actions", files: ["file-a.ts", "file-b.ts"] },
    ]);
  });
});
