import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendRunEvent,
  readRunEvents,
  readRunStatus,
  resetRunEventOffsets,
  writeRunStatus,
} from "@/lib/agent-runs/run-files";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-run-files-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("readRunEvents", () => {
  it("pages by seq cursor", () => {
    for (let i = 0; i < 5; i++) appendRunEvent(dir, { type: "text", text: `t${i}`, seq: i, ts: 1 });

    const first = readRunEvents(dir, 0, 2);
    expect(first.events.map((e) => e.seq)).toEqual([0, 1]);
    expect(first.next).toBe(2);

    const rest = readRunEvents(dir, first.next, 10);
    expect(rest.events.map((e) => e.seq)).toEqual([2, 3, 4]);
    expect(rest.next).toBe(5);

    expect(readRunEvents(dir, rest.next)).toEqual({ events: [], next: 5, total: 5 });
  });

  it("ignores a line the runner is still writing", () => {
    appendRunEvent(dir, { type: "text", text: "whole", seq: 0, ts: 1 });
    fs.appendFileSync(path.join(dir, "events.jsonl"), '{"type":"te');
    const page = readRunEvents(dir);
    expect(page.total).toBe(1);
    expect(page.next).toBe(1);
  });

  it("returns an empty page before any events exist", () => {
    expect(readRunEvents(dir, 3)).toEqual({ events: [], next: 3, total: 0 });
  });
});

describe("writeRunStatus", () => {
  it("stamps updatedAt and round-trips", () => {
    const written = writeRunStatus(dir, { state: "queued", updatedAt: 0, eventCount: 0 });
    expect(written.updatedAt).toBeGreaterThan(0);
    expect(readRunStatus(dir)).toEqual(written);
  });
});

describe("readRunEvents tail caching", () => {
  it("sees appended events across cached reads without loss or duplication", () => {
    resetRunEventOffsets();
    appendRunEvent(dir, { type: "text", text: "a", seq: 0, ts: 1 });
    appendRunEvent(dir, { type: "text", text: "b", seq: 1, ts: 2 });

    const first = readRunEvents(dir, 0, 10);
    expect(first.events.map((e) => (e.type === 'text' ? e.text : undefined))).toEqual(["a", "b"]);

    // New events land after the cache was primed.
    appendRunEvent(dir, { type: "text", text: "c", seq: 2, ts: 3 });
    const second = readRunEvents(dir, first.next, 10);
    expect(second.events.map((e) => (e.type === 'text' ? e.text : undefined))).toEqual(["c"]);
    expect(second.total).toBe(3);

    // A partial (mid-append) write is not visible until its newline lands.
    fs.appendFileSync(path.join(dir, "events.jsonl"), Buffer.from(JSON.stringify({ type: "text", text: "d", seq: 3, ts: 4 })));
    const midAppend = readRunEvents(dir, second.next, 10);
    expect(midAppend.total).toBe(3);
    fs.appendFileSync(path.join(dir, "events.jsonl"), "\n");
    const afterAppend = readRunEvents(dir, midAppend.next, 10);
    expect(afterAppend.events.map((e) => (e.type === 'text' ? e.text : undefined))).toEqual(["d"]);
    expect(afterAppend.total).toBe(4);

    // Re-reading from 0 after cached tail reads still yields everything.
    const fromZero = readRunEvents(dir, 0, 10);
    expect(fromZero.events.map((e) => (e.type === 'text' ? e.text : undefined))).toEqual(["a", "b", "c", "d"]);
    expect(fromZero.total).toBe(4);
  });

  it("recovers when the file is replaced by a shorter one", () => {
    resetRunEventOffsets();
    for (let i = 0; i < 4; i++) appendRunEvent(dir, { type: "text", text: `t${i}`, seq: i, ts: 1 });
    expect(readRunEvents(dir, 0).total).toBe(4);

    fs.writeFileSync(path.join(dir, "events.jsonl"), Buffer.from(JSON.stringify({ type: "text", text: "fresh", seq: 0, ts: 9 }) + "\n"));
    const page = readRunEvents(dir, 0, 10);
    expect(page.events.map((e) => (e.type === 'text' ? e.text : undefined))).toEqual(["fresh"]);
    expect(page.total).toBe(1);
  });

  it("handles a missing file", () => {
    resetRunEventOffsets();
    expect(readRunEvents(dir, 0)).toEqual({ events: [], next: 0, total: 0 });
  });
});
