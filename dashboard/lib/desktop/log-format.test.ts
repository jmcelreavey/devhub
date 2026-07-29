import { describe, expect, it } from "vitest";
import { formatLogTime, parseLogLine } from "./log-format";

describe("parseLogLine", () => {
  it("parses a stamped shell line", () => {
    const parsed = parseLogLine(
      "[unix_ms=1785245359103][shell:attach] [attach] navigation started",
    );
    expect(parsed.timestampMs).toBe(1785245359103);
    expect(parsed.source).toBe("shell:attach");
    expect(parsed.message).toBe("[attach] navigation started");
  });

  it("passes through unstamped lines", () => {
    const parsed = parseLogLine("not a stamped line");
    expect(parsed.timestampMs).toBeNull();
    expect(parsed.source).toBe("unknown");
    expect(parsed.message).toBe("not a stamped line");
  });
});

describe("formatLogTime", () => {
  it("returns empty for missing timestamps", () => {
    expect(formatLogTime(null)).toBe("");
  });

  it("formats a known instant as HH:MM:SS", () => {
    // Fixed UTC instant — the string depends on the local timezone, so only
    // assert the shape.
    const formatted = formatLogTime(Date.UTC(2026, 6, 28, 12, 34, 56));
    expect(formatted).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});
