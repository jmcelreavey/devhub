import { describe, it, expect } from "vitest";
import { parseRunLine, toRow } from "@/lib/run-history";

describe("parseRunLine", () => {
  it("parses a well-formed audit line", () => {
    const line = JSON.stringify({
      runId: "r1",
      script: "sync",
      startedAt: 1000,
      finishedAt: 3000,
      exitCode: 0,
    });
    expect(parseRunLine(line)).toEqual({
      runId: "r1",
      script: "sync",
      startedAt: 1000,
      finishedAt: 3000,
      exitCode: 0,
    });
  });

  it("accepts a run with no finish recorded (process died mid-run)", () => {
    const line = JSON.stringify({ runId: "r1", script: "sync", startedAt: 1000 });
    expect(parseRunLine(line)).toEqual({
      runId: "r1",
      script: "sync",
      startedAt: 1000,
      finishedAt: undefined,
      exitCode: undefined,
    });
  });

  it("returns null for blank lines", () => {
    expect(parseRunLine("")).toBeNull();
    expect(parseRunLine("   ")).toBeNull();
  });

  it("returns null for a truncated line rather than throwing", () => {
    // Exactly what a torn append or a mid-file seek produces.
    expect(parseRunLine('{"runId":"r1","script":"sy')).toBeNull();
  });

  it("returns null for JSON that isn't an object", () => {
    expect(parseRunLine("42")).toBeNull();
    expect(parseRunLine('"hello"')).toBeNull();
    expect(parseRunLine("null")).toBeNull();
  });

  it("returns null when required fields are missing or mistyped", () => {
    expect(parseRunLine(JSON.stringify({ script: "s", startedAt: 1 }))).toBeNull();
    expect(parseRunLine(JSON.stringify({ runId: "r", startedAt: 1 }))).toBeNull();
    expect(parseRunLine(JSON.stringify({ runId: "r", script: "s" }))).toBeNull();
    expect(parseRunLine(JSON.stringify({ runId: 1, script: "s", startedAt: 1 }))).toBeNull();
    expect(parseRunLine(JSON.stringify({ runId: "r", script: "s", startedAt: "1" }))).toBeNull();
  });

  it("drops mistyped optional fields instead of passing them through", () => {
    const line = JSON.stringify({
      runId: "r",
      script: "s",
      startedAt: 1,
      finishedAt: "later",
      exitCode: "0",
    });
    expect(parseRunLine(line)).toEqual({
      runId: "r",
      script: "s",
      startedAt: 1,
      finishedAt: undefined,
      exitCode: undefined,
    });
  });
});

describe("toRow", () => {
  it("computes duration from the timestamps", () => {
    const row = toRow({ runId: "r", script: "s", startedAt: 1000, finishedAt: 3500, exitCode: 0 });
    expect(row.durationMs).toBe(2500);
    expect(row.ok).toBe(true);
  });

  it("leaves duration undefined when the run never finished", () => {
    const row = toRow({ runId: "r", script: "s", startedAt: 1000 });
    expect(row.durationMs).toBeUndefined();
  });

  it("clamps a negative duration to zero rather than showing '-2s ago'", () => {
    // Clock adjustment mid-run; rare but the file is long-lived.
    const row = toRow({ runId: "r", script: "s", startedAt: 3000, finishedAt: 1000 });
    expect(row.durationMs).toBe(0);
  });

  it("treats a non-zero exit code as failure", () => {
    expect(toRow({ runId: "r", script: "s", startedAt: 1, exitCode: 1 }).ok).toBe(false);
    expect(toRow({ runId: "r", script: "s", startedAt: 1, exitCode: 130 }).ok).toBe(false);
  });

  it("treats an absent exit code as not-a-failure", () => {
    // An in-flight or interrupted run shouldn't render as a red row.
    expect(toRow({ runId: "r", script: "s", startedAt: 1 }).ok).toBe(true);
  });
});
