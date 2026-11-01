import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  describeArgs,
  isActionTool,
  localDate,
  pruneMcpHistory,
  readMcpHistory,
  readMcpHistoryWindow,
  redactArgs,
  summarizeArgs,
  summarizeMcpHistory,
  type McpHistoryEntry,
} from "./index.ts";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-history-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function entry(overrides: Partial<McpHistoryEntry>): McpHistoryEntry {
  return {
    ts: new Date(2026, 8, 14, 9, 30).getTime(),
    tool: "notes_read",
    toolset: "notes",
    args: null,
    durationMs: 10,
    ok: true,
    resultChars: 5,
    pid: 1,
    cwd: "/tmp",
    ...overrides,
  };
}

function writeDay(date: string, entries: McpHistoryEntry[]): void {
  fs.writeFileSync(path.join(dir, `${date}.jsonl`), entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

describe("redactArgs", () => {
  it("redacts secret keys, token-shaped values and URI credentials", () => {
    expect(
      redactArgs({
        apiKey: "abc",
        nested: { password: "hunter2", note: "fine" },
        header: "ghp_123456",
        url: "postgres://admin:pw@db.internal:5432/app",
      }),
    ).toEqual({
      apiKey: "‹redacted›",
      nested: { password: "‹redacted›", note: "fine" },
      header: "‹redacted›",
      url: "postgres://‹redacted›@db.internal:5432/app",
    });
  });

  it("clips long strings and oversized argument objects", () => {
    expect(String(redactArgs("x".repeat(500))).length).toBeLessThan(310);
    expect(summarizeArgs({ items: Array.from({ length: 20 }, () => "y".repeat(290)) })).toHaveProperty("_truncated");
  });
});

describe("readMcpHistory", () => {
  it("filters by tool prefix, failures, run and client, skipping corrupt lines", () => {
    const date = "2026-09-14";
    writeDay(date, [
      entry({ tool: "agent_dispatch", client: "claude-code 2.1" }),
      entry({ tool: "agent_wait", ok: false, error: "boom", agentRunId: "run-a" }),
      entry({ tool: "notes_write", client: "cursor 1.0" }),
    ]);
    fs.appendFileSync(path.join(dir, `${date}.jsonl`), "{not json\n");

    expect(readMcpHistory(dir, date)).toHaveLength(3);
    expect(readMcpHistory(dir, date, { tool: "agent_*" }).map((e) => e.tool)).toEqual(["agent_dispatch", "agent_wait"]);
    expect(readMcpHistory(dir, date, { errorsOnly: true }).map((e) => e.tool)).toEqual(["agent_wait"]);
    expect(readMcpHistory(dir, date, { agentRunId: "run-a" })).toHaveLength(1);
    expect(readMcpHistory(dir, date, { client: "CURSOR" }).map((e) => e.tool)).toEqual(["notes_write"]);
    expect(readMcpHistory(dir, "../etc")).toEqual([]);
  });
});

describe("readMcpHistoryWindow", () => {
  it("reads across local days and keeps only the window", () => {
    const lateMon = new Date(2026, 8, 14, 23, 0).getTime();
    const earlyTue = new Date(2026, 8, 15, 8, 0).getTime();
    const lateTue = new Date(2026, 8, 15, 20, 0).getTime();
    writeDay("2026-09-14", [entry({ ts: lateMon, tool: "a_run" })]);
    writeDay("2026-09-15", [entry({ ts: earlyTue, tool: "b_run" }), entry({ ts: lateTue, tool: "c_run" })]);

    const tools = readMcpHistoryWindow(dir, new Date(2026, 8, 14, 22, 0).getTime(), new Date(2026, 8, 15, 12, 0).getTime()).map(
      (e) => e.tool,
    );
    expect(tools).toEqual(["a_run", "b_run"]);
    expect(readMcpHistoryWindow(dir, lateTue, lateMon)).toEqual([]);
  });
});

describe("summarizeMcpHistory", () => {
  it("counts calls and pulls out actions, failures and agent runs", () => {
    const summary = summarizeMcpHistory("2026-09-14", [
      entry({ tool: "notes_read" }),
      entry({ tool: "notes_write", args: { path: "daily/2026-09-14", content: "…" } }),
      entry({ tool: "agent_dispatch", toolset: "agents", args: { provider: "claude", title: "Fix tests" } }),
      entry({ tool: "db_execute", toolset: "db", ok: false, error: "confirm_required", agentRunId: "run-b" }),
    ]);

    expect(summary.total).toBe(4);
    expect(summary.failed).toBe(1);
    expect(summary.toolsets[0]).toEqual({ toolset: "notes", count: 2 });
    expect(summary.actions.map((a) => `${a.tool} ${a.detail}`)).toEqual([
      "notes_write path=daily/2026-09-14",
      "agent_dispatch title=Fix tests provider=claude",
      "db_execute ",
    ]);
    expect(summary.errors).toEqual([{ ts: expect.any(Number), tool: "db_execute", error: "confirm_required" }]);
    expect(summary.agentRunIds).toEqual(["run-b"]);
  });

  it("classifies read-only tools as non-actions", () => {
    expect(isActionTool("notes_read")).toBe(false);
    expect(isActionTool("repos_git_commit")).toBe(true);
    expect(isActionTool("terminal_propose_run")).toBe(true);
    expect(describeArgs(["not", "an", "object"])).toBe("");
  });
});

describe("pruneMcpHistory", () => {
  it("removes only day files older than the retention window", () => {
    const now = new Date(2026, 8, 14, 12).getTime();
    writeDay("2026-08-01", []);
    writeDay(localDate(now), []);
    fs.writeFileSync(path.join(dir, "notes.txt"), "keep");

    expect(pruneMcpHistory(dir, 30, now)).toBe(1);
    expect(fs.readdirSync(dir).sort()).toEqual([`${localDate(now)}.jsonl`, "notes.txt"]);
  });
});
