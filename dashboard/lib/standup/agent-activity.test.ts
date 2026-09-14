import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadStandupAgentActivity } from "@/lib/standup/agent-activity";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "standup-agent-activity-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function line(ts: number, tool: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ ts, tool, toolset: null, args: null, durationMs: 1, ok: true, resultChars: 0, pid: 1, cwd: "/", ...extra });
}

describe("loadStandupAgentActivity", () => {
  it("returns null when nothing ran in the window", () => {
    expect(loadStandupAgentActivity(Date.now() - 60_000, Date.now(), dir)).toBeNull();
  });

  it("summarises calls in the window and formats actions", () => {
    const at = new Date(2026, 8, 14, 10).getTime();
    fs.writeFileSync(
      path.join(dir, "2026-09-14.jsonl"),
      [
        line(at, "notes_read"),
        line(at + 1, "agent_dispatch", { args: { provider: "claude", title: "Fix CI" } }),
        line(at + 2, "db_execute", { ok: false }),
        line(new Date(2026, 8, 14, 23, 30).getTime(), "tasks_create"),
      ].join("\n"),
    );

    const activity = loadStandupAgentActivity(at - 1, new Date(2026, 8, 14, 12).getTime(), dir);
    expect(activity).toEqual({
      total: 3,
      failed: 1,
      actions: ["agent_dispatch title=Fix CI provider=claude", "db_execute (failed)"],
      actionsTruncated: false,
    });
  });
});
