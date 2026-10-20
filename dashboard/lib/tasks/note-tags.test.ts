import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { textToBlocks } from "@shared/markdown-convert/index.ts";
import { buildTaskNoteMarkdown } from "@shared/task-note/index.ts";
import { applyTaskNoteOp, parseTaskNoteOp } from "@shared/task-note/sections.ts";
import type { Task } from "@/lib/tasks/types";
import { taskNoteTags } from "./note-tags";
import { matchesTaskSearch } from "./task-text";

describe("task-note tags in the Work search", () => {
  it("maps each task to its note's tags and lets #tag find the task", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "note-tags-"));
    fs.mkdirSync(path.join(dir, "task-notes"));
    let blocks = textToBlocks(buildTaskNoteMarkdown({ id: "task-1", text: "Wire pills", date: "2026-10-16" })) as unknown[];
    const parsed = parseTaskNoteOp({ op: "set_meta", tags: ["Storyboard"] });
    if (!parsed.ok) throw new Error(parsed.error);
    blocks = applyTaskNoteOp(blocks, parsed.op).blocks;
    fs.writeFileSync(path.join(dir, "task-notes", "2026-10-16-task-1.json"), JSON.stringify(blocks));
    fs.writeFileSync(path.join(dir, "task-notes", "scratch.json"), "[]");

    const tags = taskNoteTags(dir);
    expect(tags).toEqual({ "task-1": ["storyboard"] });
    const task = { id: "task-1", text: "Wire pills", done: false } as Task;
    expect(matchesTaskSearch(task, "#storyboard")).toBe(false);
    expect(matchesTaskSearch(task, "#storyboard", tags)).toBe(true);
    expect(matchesTaskSearch({ ...task, id: "other" }, "#storyboard", tags)).toBe(false);
  });
});
