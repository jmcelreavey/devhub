import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendEvent, appendEvents, countEvents, parseEventLine, readEvents } from "./events";
import { eventsDir, eventsFile } from "./paths";

let tmp: string;
const originalNotesDir = process.env.NOTES_DIR;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "recall-events-"));
  process.env.NOTES_DIR = tmp;
});

afterEach(() => {
  if (originalNotesDir === undefined) delete process.env.NOTES_DIR;
  else process.env.NOTES_DIR = originalNotesDir;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("parseEventLine", () => {
  it("returns null for a truncated final line instead of throwing", () => {
    // The normal state of an interrupted append-only log. One lost event is
    // acceptable; a log that won't load is not.
    expect(parseEventLine('{"id":"a","ts":"2026-01-01T00:00:00Z","kind":"comm')).toBeNull();
  });

  it("rejects lines missing required fields or with an unknown kind", () => {
    expect(parseEventLine("{}")).toBeNull();
    expect(parseEventLine('{"id":"a","ts":"x","title":"t","kind":"nonsense"}')).toBeNull();
    expect(parseEventLine('{"id":"a","ts":"x","kind":"commit"}')).toBeNull();
  });

  it("ignores blank lines", () => {
    expect(parseEventLine("")).toBeNull();
    expect(parseEventLine("   ")).toBeNull();
  });
});

describe("appendEvent", () => {
  it("writes one NDJSON line per event", () => {
    appendEvent({ kind: "commit", title: "first", source: "test" });
    appendEvent({ kind: "commit", title: "second", source: "test" });
    const raw = fs.readFileSync(eventsFile(), "utf-8");
    expect(raw.trim().split("\n")).toHaveLength(2);
  });

  it("derives entity refs from the title and body", () => {
    const event = appendEvent({
      kind: "commit",
      title: "fix PTF-3774 cache purge",
      body: "see owner/repo#525",
      source: "test",
    });
    const ids = (event.refs ?? []).map((r) => r.id);
    expect(ids).toContain("PTF-3774");
    expect(ids).toContain("owner/repo#525");
  });

  it("shards by month so no file grows without bound", () => {
    appendEvent({ kind: "manual", title: "jan", source: "t", ts: "2026-01-15T00:00:00.000Z" });
    appendEvent({ kind: "manual", title: "feb", source: "t", ts: "2026-02-15T00:00:00.000Z" });
    const shards = fs.readdirSync(eventsDir()).sort();
    expect(shards).toEqual(["2026-01.ndjson", "2026-02.ndjson"]);
  });

  it("truncates absurd input rather than storing it", () => {
    const event = appendEvent({ kind: "manual", title: "x".repeat(9000), source: "t" });
    expect(event.title).toHaveLength(500);
  });
});

describe("appendEvents", () => {
  it("skips ids already written — the property ingestion depends on", () => {
    const input = { kind: "commit" as const, title: "dup", source: "t", id: "stable-1" };
    expect(appendEvents([input])).toHaveLength(1);
    expect(appendEvents([input])).toHaveLength(0);
    expect(countEvents()).toBe(1);
  });

  it("writes events without ids every time", () => {
    const input = { kind: "manual" as const, title: "anon", source: "t" };
    appendEvents([input]);
    appendEvents([input]);
    expect(countEvents()).toBe(2);
  });

  it("handles an empty batch", () => {
    expect(appendEvents([])).toEqual([]);
  });

  it("dedupes against ids in older shards, not just recent ones", () => {
    appendEvents([
      {
        kind: "commit",
        title: "old",
        source: "t",
        id: "ancient",
        ts: "2020-01-15T00:00:00.000Z",
      },
    ]);
    expect(
      appendEvents([
        {
          kind: "commit",
          title: "old again",
          source: "t",
          id: "ancient",
          ts: "2026-06-01T00:00:00.000Z",
        },
      ]),
    ).toHaveLength(0);
    expect(countEvents()).toBe(1);
  });
});

describe("readEvents", () => {
  it("returns newest first across shards", () => {
    appendEvent({ kind: "manual", title: "older", source: "t", ts: "2026-01-01T00:00:00.000Z" });
    appendEvent({ kind: "manual", title: "newer", source: "t", ts: "2026-03-01T00:00:00.000Z" });
    expect(readEvents().map((e) => e.title)).toEqual(["newer", "older"]);
  });

  it("filters by kind and since", () => {
    appendEvent({ kind: "commit", title: "c", source: "t", ts: "2026-01-01T00:00:00.000Z" });
    appendEvent({ kind: "alert", title: "a", source: "t", ts: "2026-06-01T00:00:00.000Z" });
    expect(readEvents({ kinds: ["alert"] }).map((e) => e.title)).toEqual(["a"]);
    expect(readEvents({ since: "2026-03-01T00:00:00.000Z" }).map((e) => e.title)).toEqual(["a"]);
  });

  it("honours the limit", () => {
    for (let i = 0; i < 10; i++) appendEvent({ kind: "manual", title: `e${i}`, source: "t" });
    expect(readEvents({ limit: 3 })).toHaveLength(3);
  });

  it("orders by instant, not file order or lexicographic timestamps", () => {
    // git log is newest-first; appendEvents writes in that order, so reverse
    // file order would return oldest first. Offsets also break string compare:
    // 08:00-04:00 (12:00 UTC) is later than 12:00+01:00 (11:00 UTC).
    appendEvent({
      kind: "commit",
      title: "london-noon",
      source: "git",
      ts: "2026-06-01T12:00:00+01:00",
      id: "lon",
    });
    appendEvent({
      kind: "commit",
      title: "ny-morning",
      source: "git",
      ts: "2026-06-01T08:00:00-04:00",
      id: "nyc",
    });
    appendEvent({
      kind: "commit",
      title: "utc-dawn",
      source: "git",
      ts: "2026-06-01T10:00:00.000Z",
      id: "utc",
    });
    expect(readEvents().map((e) => e.title)).toEqual(["ny-morning", "london-noon", "utc-dawn"]);
  });

  it("compares since as instants when offsets mix", () => {
    appendEvent({
      kind: "commit",
      title: "before",
      source: "git",
      ts: "2026-06-01T12:00:00+01:00",
      id: "before",
    });
    appendEvent({
      kind: "commit",
      title: "after",
      source: "git",
      ts: "2026-06-01T08:00:00-04:00",
      id: "after",
    });
    expect(readEvents({ since: "2026-06-01T11:30:00.000Z" }).map((e) => e.title)).toEqual(["after"]);
  });

  it("returns [] when nothing has ever been written", () => {
    expect(readEvents()).toEqual([]);
    expect(countEvents()).toBe(0);
  });

  it("survives a corrupt line mid-file", () => {
    // Explicit timestamps: readEvents ties on equal instants and breaks them by id,
    // which is a random UUID, so two events appended in the same millisecond come
    // back in either order. On a fast run these two landed in the same millisecond
    // and the assertion flipped. The subject here is the corrupt line, not ordering.
    appendEvent({ kind: "manual", title: "good", source: "t", ts: "2026-08-01T10:00:00.000Z" });
    fs.appendFileSync(eventsFile(), "{ not json\n");
    appendEvent({ kind: "manual", title: "also good", source: "t", ts: "2026-08-01T10:00:01.000Z" });
    expect(readEvents().map((e) => e.title)).toEqual(["also good", "good"]);
  });
});
