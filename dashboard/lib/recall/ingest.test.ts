import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eventId, parseGitLog } from "./ingest";

const FIELD = "\x1f";
const RECORD = "\x1e";

function sha1(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

function record(commit: {
  sha: string;
  author: string;
  date: string;
  subject: string;
  body?: string;
}): string {
  return [commit.sha, commit.author, commit.date, commit.subject, commit.body ?? ""].join(FIELD) + RECORD;
}

describe("parseGitLog", () => {
  it("splits records and fields on the unit/record separators", () => {
    const first = sha1("a");
    const second = sha1("b");
    const stdout =
      record({
        sha: first,
        author: "Ada",
        date: "2026-06-01T12:00:00+01:00",
        subject: "fix PTF-1",
        body: "details",
      }) +
      record({
        sha: second,
        author: "Bob",
        date: "2026-06-01T08:00:00-04:00",
        subject: "docs",
      });

    const commits = parseGitLog(stdout);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toEqual({
      sha: first,
      authorName: "Ada",
      isoDate: "2026-06-01T12:00:00+01:00",
      subject: "fix PTF-1",
      body: "details",
    });
    expect(commits[1].sha).toBe(second);
    expect(commits[1].isoDate).toBe("2026-06-01T08:00:00-04:00");
  });

  it("drops records whose hash is not a full SHA-1", () => {
    expect(parseGitLog(`not-a-sha${FIELD}Ada${FIELD}2026-01-01T00:00:00Z${FIELD}x${FIELD}${RECORD}`)).toEqual([]);
  });

  it("drops records with an empty subject", () => {
    const full = sha1("c");
    expect(parseGitLog(`${full}${FIELD}Ada${FIELD}2026-01-01T00:00:00Z${FIELD}${FIELD}${RECORD}`)).toEqual([]);
  });
});

describe("eventId", () => {
  it("is stable for the same source and key", () => {
    expect(eventId("git", "devhub:abc")).toBe(eventId("git", "devhub:abc"));
  });

  it("changes when the key changes", () => {
    expect(eventId("git", "devhub:aaa")).not.toBe(eventId("git", "devhub:bbb"));
  });

  it("is a 24-character hex digest", () => {
    expect(eventId("git", "devhub:abc")).toMatch(/^[a-f0-9]{24}$/);
  });
});
