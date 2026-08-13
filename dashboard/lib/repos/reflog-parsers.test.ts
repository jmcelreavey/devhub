import { describe, expect, it } from "vitest";
import {
  dedupeConsecutive,
  markUnreachable,
  parseReflog,
  type ReflogEntry,
} from "@/lib/repos/reflog-parsers";

const RS = String.fromCharCode(30);
const NUL = String.fromCharCode(0);

/** One record in the shape `--format=%x1e%H%x00%h%x00%gd%x00%gs%x00%gr` emits. */
function record(hash: string, selector: string, subject: string, date = "2 hours ago") {
  return RS + [hash, hash.slice(0, 7), selector, subject, date].join(NUL);
}

function entry(hash: string): ReflogEntry {
  return {
    selector: "HEAD@{0}",
    hash,
    shortHash: hash.slice(0, 7),
    action: "commit",
    detail: "",
    relativeDate: "now",
  };
}

describe("parseReflog", () => {
  it("splits the subject into action and detail", () => {
    const [row] = parseReflog(
      record("a".repeat(40), "HEAD@{0}", "reset: moving to HEAD~3"),
    );
    expect(row).toMatchObject({
      selector: "HEAD@{0}",
      shortHash: "aaaaaaa",
      action: "reset",
      detail: "moving to HEAD~3",
      relativeDate: "2 hours ago",
    });
  });

  it("keeps a subject with no colon as the action", () => {
    // %gs is free-form; dropping these would hide entries.
    const [row] = parseReflog(record("b".repeat(40), "HEAD@{1}", "initial pull"));
    expect(row).toMatchObject({ action: "initial pull", detail: "" });
  });

  it("splits only on the first colon", () => {
    const [row] = parseReflog(
      record("c".repeat(40), "HEAD@{2}", "checkout: moving from a to b: the branch"),
    );
    expect(row?.detail).toBe("moving from a to b: the branch");
  });

  it("parses several records", () => {
    const rows = parseReflog(
      record("a".repeat(40), "HEAD@{0}", "commit: one") +
        record("b".repeat(40), "HEAD@{1}", "commit: two"),
    );
    expect(rows).toHaveLength(2);
  });

  it("drops records with no hash rather than emitting a blank row", () => {
    expect(parseReflog(record("", "HEAD@{0}", "commit: x"))).toEqual([]);
    expect(parseReflog("")).toEqual([]);
  });
});

describe("markUnreachable", () => {
  it("flags a commit no ref points at", () => {
    // The reason the browser exists: this commit is recoverable from here and
    // from nowhere else.
    const [lost, kept] = markUnreachable(
      [entry("a".repeat(40)), entry("b".repeat(40))],
      new Set(["b".repeat(40)]),
    );
    expect(lost?.unreachable).toBe(true);
    expect(kept?.unreachable).toBe(false);
  });

  it("treats an empty reachable set as everything being unreachable", () => {
    const [row] = markUnreachable([entry("a".repeat(40))], new Set());
    expect(row?.unreachable).toBe(true);
  });
});

describe("dedupeConsecutive", () => {
  it("collapses a run of entries at the same commit", () => {
    // Checking out between branches that share a tip writes several entries for
    // one position; the list should read as places HEAD has been.
    const rows = dedupeConsecutive([entry("a".repeat(40)), entry("a".repeat(40)), entry("b".repeat(40))]);
    expect(rows).toHaveLength(2);
  });

  it("keeps a commit that recurs after moving away", () => {
    // Returning to a commit is a genuine event, not a duplicate write.
    const rows = dedupeConsecutive([entry("a".repeat(40)), entry("b".repeat(40)), entry("a".repeat(40))]);
    expect(rows).toHaveLength(3);
  });

  it("handles an empty list", () => {
    expect(dedupeConsecutive([])).toEqual([]);
  });
});
