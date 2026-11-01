import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentCallerFromEnv, readAgentNoteUpdates, recordAgentNoteUpdate } from "./agent-updates.ts";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-updates-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("agent note updates", () => {
  it("knows an agent's MCP process by its depth or run id, and a person's by neither", () => {
    expect(agentCallerFromEnv({})).toBeNull();
    expect(agentCallerFromEnv({ DEVHUB_AGENT_DEPTH: "0" })).toBeNull();
    expect(agentCallerFromEnv({ DEVHUB_AGENT_DEPTH: "1" })).toEqual({ depth: 1 });
    expect(agentCallerFromEnv({ DEVHUB_AGENT_RUN_ID: "run-9" })).toEqual({ runId: "run-9" });
  });

  it("keeps the last update per note", () => {
    expect(readAgentNoteUpdates(dir)).toEqual({});
    recordAgentNoteUpdate(dir, "task-notes/a", { at: "2026-10-17T10:00:00.000Z", op: "set_status", depth: 1 });
    recordAgentNoteUpdate(dir, "task-notes/a", { at: "2026-10-17T11:00:00.000Z", op: "add_media", depth: 1 });
    recordAgentNoteUpdate(dir, "task-notes/b", { at: "2026-10-17T09:00:00.000Z", op: "set_summary", runId: "r" });
    expect(readAgentNoteUpdates(dir)).toEqual({
      "task-notes/a": { at: "2026-10-17T11:00:00.000Z", op: "add_media", depth: 1 },
      "task-notes/b": { at: "2026-10-17T09:00:00.000Z", op: "set_summary", runId: "r" },
    });
  });
});
