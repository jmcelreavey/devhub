import { describe, expect, it } from "vitest";
import { appendSessionHistory, type SessionHistoryEntry } from "./session-history";

const entry = (href: string, ts: number): SessionHistoryEntry => ({ href, label: href, ts });

describe("appendSessionHistory", () => {
  it("collapses consecutive visits to the same destination", () => {
    expect(appendSessionHistory([entry("/notes", 1)], entry("/notes", 2))).toEqual([
      entry("/notes", 2),
    ]);
  });

  it("keeps revisits that describe a real back-and-forth trail", () => {
    expect(
      appendSessionHistory([entry("/notes", 1), entry("/repos", 2)], entry("/notes", 3)),
    ).toHaveLength(3);
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
