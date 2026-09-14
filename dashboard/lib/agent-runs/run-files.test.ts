import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendRunEvent, readRunEvents, readRunStatus, writeRunStatus } from "@/lib/agent-runs/run-files";

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
