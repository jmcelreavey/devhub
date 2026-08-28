import { describe, expect, it } from "vitest";
import { appendSessionHistory, type SessionHistoryEntry } from "./session-history";

const entry = (href: string, ts: number): SessionHistoryEntry => ({ href, label: href, ts });

describe("appendSessionHistory", () => {
  it("collapses consecutive visits to the same destination", () => {
    expect(appendSessionHistory([entry("/notes", 1)], entry("/notes", 2))).toEqual([
      entry("/notes", 2),
    ]);
  });

  it("pops when navigating back to the previous entry", () => {
    expect(
      appendSessionHistory([entry("/notes", 1), entry("/repos", 2)], entry("/notes", 3)),
    ).toEqual([entry("/notes", 1)]);
  });

  it("does not treat a longer trail as a back-pop", () => {
    expect(
      appendSessionHistory(
        [entry("/notes", 1), entry("/repos", 2), entry("/work", 3)],
        entry("/notes", 4),
      ).map((item) => item.href),
    ).toEqual(["/notes", "/repos", "/work", "/notes"]);
  });

  it("treats trailing slashes as the same href", () => {
    expect(appendSessionHistory([entry("/work", 1)], entry("/work/", 2))).toEqual([
      entry("/work", 2),
    ]);
  });

  it("keeps only the newest entries", () => {
    const history = [entry("/1", 1), entry("/2", 2), entry("/3", 3)];
    expect(appendSessionHistory(history, entry("/4", 4), 3).map((item) => item.href)).toEqual([
      "/2",
      "/3",
      "/4",
    ]);
  });
});
