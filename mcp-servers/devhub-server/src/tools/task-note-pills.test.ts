import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyTaskNoteOp, parseTaskNoteOp } from "../../../../shared/task-note/sections.ts";
import { buildTaskNoteMarkdown } from "../../../../shared/task-note/index.ts";
import type { Context } from "../context.ts";
import { textToBlocks } from "../convert.ts";
import { NotesStorage } from "../storage.ts";
import { notesByTag, readNotePills, recordIfAgent, registerTaskNoteTools } from "./task-note.ts";
import { readAgentNoteUpdates } from "../../../../shared/task-note/agent-updates.ts";

function writeNote(dir: string, name: string, ops: Array<Record<string, unknown>>) {
  let blocks = textToBlocks(buildTaskNoteMarkdown({ id: name, text: `Task ${name}`, date: "2026-10-16" })) as unknown[];
  for (const raw of ops) {
    const parsed = parseTaskNoteOp(raw);
    if (!parsed.ok) throw new Error(parsed.error);
    blocks = applyTaskNoteOp(blocks, parsed.op).blocks;
  }
  fs.mkdirSync(path.join(dir, "task-notes"), { recursive: true });
  fs.writeFileSync(path.join(dir, "task-notes", `${name}.json`), JSON.stringify(blocks));
}

describe("task note pills over MCP", () => {
  it("reads pills with the same destinations as the GUI and filters notes by tag", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pills-"));
    writeNote(dir, "a", [{ op: "set_status", status: "blocked" }, { op: "set_meta", tags: ["auth"], models: ["sonnet"], links: [{ kind: "pr", id: "p", label: "PR", href: "https://github.com/x/y/pull/1" }, { kind: "note", id: "n", label: "Design" }] }]);
    writeNote(dir, "b", [{ op: "set_meta", tags: ["other"] }]);
    const pills = readNotePills(dir, "task-notes/a")!;
    expect(pills.status).toBe("blocked");
    expect(pills.tags).toEqual([{ tag: "auth", href: "/work?tab=tasks&tag=auth" }]);
    expect(pills.links.map((l) => l.href)).toEqual(["https://github.com/x/y/pull/1", "/work?tab=tasks&q=n"]);
    expect(pills.models[0].href).toBe("/storyboard?settings=model-tiers");
    expect(notesByTag(dir, "#AUTH").map((n) => n.notePath)).toEqual(["task-notes/a"]);
    expect(readNotePills(dir, "../escape")).toBeNull();
  });
});

describe("task_note_update stamps the card only for real edits", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("keeps the first edit's time when an agent repeats a call that changes nothing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-note-tool-"));
    writeNote(dir, "a", []);
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const server = { registerTool: (name: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => handlers.set(name, handler) } as unknown as McpServer;
    registerTaskNoteTools(server, { notesDir: dir, storage: new NotesStorage(dir), tasksStorage: { ready: async () => undefined } } as unknown as Context);
    const update = handlers.get("task_note_update")!;
    vi.stubEnv("DEVHUB_AGENT_DEPTH", "1");
    vi.useFakeTimers();

    vi.setSystemTime(new Date("2026-10-17T12:00:00Z"));
    await update({ notePath: "task-notes/a", op: "set_status", status: "in-progress" });
    expect(readAgentNoteUpdates(dir)["task-notes/a"]).toMatchObject({ at: "2026-10-17T12:00:00.000Z", op: "set_status" });

    vi.setSystemTime(new Date("2026-10-17T12:05:00Z"));
    await update({ notePath: "task-notes/a", op: "set_status", status: "in-progress" });
    expect(readAgentNoteUpdates(dir)["task-notes/a"].at).toBe("2026-10-17T12:00:00.000Z");

    vi.setSystemTime(new Date("2026-10-17T12:10:00Z"));
    await update({ notePath: "task-notes/a", op: "set_status", status: "blocked" });
    expect(readAgentNoteUpdates(dir)["task-notes/a"].at).toBe("2026-10-17T12:10:00.000Z");
  });
});

describe("task_note_update records agent edits", () => {
  it("records an agent's write, but not a read or a person's write", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-note-"));
    const now = new Date("2026-10-17T12:00:00Z");
    expect(recordIfAgent(dir, "task-notes/a", "set_status", {}, now)).toBe(false);
    expect(recordIfAgent(dir, "task-notes/a", "read", { DEVHUB_AGENT_DEPTH: "1" }, now)).toBe(false);
    expect(readAgentNoteUpdates(dir)).toEqual({});
    expect(recordIfAgent(dir, "task-notes/a", "add_media", { DEVHUB_AGENT_DEPTH: "1" }, now)).toBe(true);
    expect(readAgentNoteUpdates(dir)).toEqual({ "task-notes/a": { at: "2026-10-17T12:00:00.000Z", op: "add_media", depth: 1 } });
  });
});

it("accepts structured milestone context and keeps the existing MCP text result", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "structured-note-tool-"));
  try {
    writeNote(dir, "a", []);
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const server = { registerTool: (name: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => handlers.set(name, handler) } as unknown as McpServer;
    const storage = new NotesStorage(dir);
    registerTaskNoteTools(server, { notesDir: dir, storage, tasksStorage: { ready: async () => undefined } } as unknown as Context);
    const result = await handlers.get("task_note_update")!({ notePath: "task-notes/a", op: "set_status_update", statusUpdate: { summary: "Plan ready", whatChanged: "Added the plan", currentState: "Waiting", nextStep: "Approve" } });
    expect(result).toEqual({ content: [{ type: "text", text: expect.stringContaining("Status update saved: task-notes/a") }] });
    const read = await handlers.get("task_note_update")!({ notePath: "task-notes/a", op: "read" });
    expect(read).toEqual({ content: [{ type: "text", text: expect.stringContaining("Summary: set") }] });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
