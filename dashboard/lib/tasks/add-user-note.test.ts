import { describe, expect, it, vi } from "vitest";
import { blocksToText, textToBlocks } from "@shared/markdown-convert/index.ts";
import { updateTaskNote } from "@shared/task-note/update.ts";
import { addUserNote, noteUpdateMode, type AddUserNoteDeps, type NoteCapability } from "./add-user-note";

const now = new Date("2026-10-19T10:00:00Z");
const idle: NoteCapability = { running: false, auto: false, liveFollowup: false, confirmNeeded: false };
const note = { id: "n1", text: "Keep the existing API.\nAlso keep the tests.", at: now.toISOString() };
function setup(capability = idle) {
  const deps: AddUserNoteDeps = { capability: vi.fn(async () => capability), save: vi.fn(async () => note), followup: vi.fn(async () => {}), stop: vi.fn(async () => {}), resume: vi.fn(async () => "next"), continueAuto: vi.fn(async () => "auto-next") };
  return deps;
}

describe("owner notes", () => {
  it("appends a timestamped human entry without touching other sections", async () => {
    let content: unknown[] = textToBlocks("# Task\n\n## Decisions\n- Keep the API\n\n## Personal context\nUntouched\n\n## Log\n- Earlier entry");
    const store = { read: () => ({ content, modified: 1 }), write: (_path: string, next: unknown) => { content = next as unknown[]; } };
    const before = updateTaskNote(store, "task-notes/test", { op: "read" }, { notesRoot: "/tmp" }).view;
    const deps = setup();
    deps.save = async (input) => updateTaskNote(store, "task-notes/test", { op: "add_user_note", text: input.text }, { notesRoot: "/tmp", now }).view.userNotes.at(-1)!;
    const result = await addUserNote({ taskId: "t1", text: note.text }, deps);
    const after = updateTaskNote(store, "task-notes/test", { op: "read" }, { notesRoot: "/tmp" }).view;
    expect(after.userNotes).toEqual([expect.objectContaining({ text: note.text, at: now.toISOString() })]);
    expect(after.decisions).toEqual(before.decisions);
    expect(after.log).toEqual(before.log);
    expect(after.freeformCount).toBe(before.freeformCount);
    expect(JSON.stringify(content)).toContain("Your notes");
    const markdown = blocksToText(content);
    expect(markdown).toContain("## Your notes");
    expect(markdown).toContain(now.toISOString());
    expect(markdown).toContain("Keep the existing API.");
    expect(markdown).toContain("Also keep the tests.");
    expect(result.agent.mode).toBe("none");
    expect(deps.stop).not.toHaveBeenCalled();
  });
  it("save-only does not touch a running run", async () => {
    const deps = setup({ ...idle, running: true, runId: "r1", liveFollowup: true });
    await addUserNote({ taskId: "t1", text: note.text }, deps);
    expect(deps.followup).not.toHaveBeenCalled(); expect(deps.stop).not.toHaveBeenCalled(); expect(deps.resume).not.toHaveBeenCalled();
  });
  it("sends an explicitly labelled live follow-up without stopping", async () => {
    const deps = setup({ ...idle, running: true, runId: "r1", liveFollowup: true });
    expect((await addUserNote({ taskId: "t1", text: note.text, updateAgent: true }, deps)).agent).toEqual({ mode: "followup", runId: "r1" });
    expect(deps.followup).toHaveBeenCalledWith("t1", "r1", expect.stringContaining(note.text), note.id);
    expect(deps.followup).toHaveBeenCalledWith("t1", "r1", expect.stringContaining("Note from John"), note.id);
    expect(deps.stop).not.toHaveBeenCalled();
  });
  it("stops cleanly before resuming with guidance", async () => {
    const deps = setup({ ...idle, running: true, runId: "r1" });
    expect((await addUserNote({ taskId: "t1", text: note.text, updateAgent: true }, deps)).agent.mode).toBe("restarted");
    expect(deps.stop).toHaveBeenCalledWith("t1");
    expect(deps.resume).toHaveBeenCalledWith("t1", expect.stringContaining(note.text));
    expect(vi.mocked(deps.stop).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(deps.resume).mock.invocationCallOrder[0]);
  });
  it("continues Auto's current stage rather than starting a new task", async () => {
    const deps = setup({ ...idle, running: true, auto: true });
    expect((await addUserNote({ taskId: "t1", text: note.text, updateAgent: true }, deps)).agent.mode).toBe("auto-continued");
    expect(deps.continueAuto).toHaveBeenCalledWith("t1", expect.stringContaining(note.text)); expect(deps.resume).not.toHaveBeenCalled();
  });
  it("only gates a destructive stop, not save-only or live sending", async () => {
    const deps = setup({ ...idle, running: true, confirmNeeded: true });
    const result = await addUserNote({ taskId: "t1", text: note.text, updateAgent: true }, deps);
    expect(result.saved).toBe(true); expect(result.agent.error).toMatch(/confirm/); expect(deps.stop).not.toHaveBeenCalled();
    await addUserNote({ taskId: "t1", text: note.text, updateAgent: true, confirmStop: true }, deps);
    expect(deps.stop).toHaveBeenCalledOnce();
    expect(noteUpdateMode({ ...idle, confirmNeeded: true })).toBe("none");
  });
  it("does not resume after stop fails and reports the already saved note", async () => {
    const deps = setup({ ...idle, running: true }); vi.mocked(deps.stop).mockRejectedValue(new Error("still stopping"));
    const result = await addUserNote({ taskId: "t1", text: note.text, updateAgent: true }, deps);
    expect(result.saved).toBe(true); expect(result.agent.error).toContain("still stopping"); expect(deps.resume).not.toHaveBeenCalled();
  });
  it("keeps the saved receipt when the run capability lookup fails", async () => {
    const deps = setup();
    vi.mocked(deps.capability).mockRejectedValue(new Error("agent store unavailable"));
    const result = await addUserNote({ taskId: "t1", text: note.text, updateAgent: true }, deps);
    expect(result.note).toEqual(note);
    expect(result.saved).toBe(true);
    expect(result.agent.error).toContain("agent store unavailable");
    expect(deps.stop).not.toHaveBeenCalled();
  });
});
