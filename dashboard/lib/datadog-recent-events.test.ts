import { describe, it, expect } from "vitest";
import { extractRecentEvent } from "./datadog-recent-events";

describe("extractRecentEvent", () => {
  it("reads title/status/tags/timestamp from a nested v2 event", () => {
    const raw = {
      id: "evt-1",
      attributes: {
        timestamp: 1780000000000,
        tags: ["service:billing", "env:prod"],
        attributes: { title: "CPU high on billing", status: "error" },
      },
    };
    expect(extractRecentEvent(raw)).toEqual({
      id: "evt-1",
      title: "CPU high on billing",
      timestampMs: 1780000000000,
      status: "error",
      tags: ["service:billing", "env:prod"],
    });
  });

  it("falls back to the first line of message and parses ISO timestamps", () => {
    const raw = {
      id: "evt-2",
      attributes: { timestamp: "2026-05-30T10:00:00Z", message: "Disk almost full\nmore detail" },
    };
    const out = extractRecentEvent(raw);
    expect(out.title).toBe("Disk almost full");
    expect(out.status).toBeUndefined();
    expect(out.tags).toEqual([]);
    expect(out.timestampMs).toBe(Date.parse("2026-05-30T10:00:00Z"));
  });

  it("degrades gracefully on an empty object", () => {
    expect(extractRecentEvent({})).toEqual({ id: "", title: "(untitled alert)", timestampMs: 0, status: undefined, tags: [] });
  });
});
