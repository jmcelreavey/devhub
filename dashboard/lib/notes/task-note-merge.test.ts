import { describe, expect, it } from "vitest";
import { textToBlocks } from "@shared/markdown-convert/index.ts";
import { buildTaskNoteMarkdown } from "@shared/task-note/index.ts";
import { applyTaskNoteOp, parseTaskNoteOp, readTaskNote, splitTaskNote } from "@shared/task-note/sections.ts";
import { mergeAgentEditsIntoTask } from "./task-note-merge";

function withOp(blocks: unknown[], raw: Record<string, unknown>): unknown[] {
  const parsed = parseTaskNoteOp(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  return applyTaskNoteOp(blocks, parsed.op).blocks;
}

const base = textToBlocks(buildTaskNoteMarkdown({ id: "t1", text: "Merge me", date: "2026-10-16" })) as unknown[];

describe("mergeAgentEditsIntoTask", () => {
  it("keeps the stored sections and takes the free-form blocks being saved", () => {
    const stored = withOp(base, { op: "set_summary", text: "Written by an agent." });
    const mine = textToBlocks("# Merge me\n\n## Notes\n\n- my own line") as unknown[];
    const merged = mergeAgentEditsIntoTask({ content: stored }, mine);
    expect(merged).not.toBeNull();
    expect(readTaskNote(merged!.blocks as unknown[]).summary).toHaveLength(1);
    const freeform = splitTaskNote(merged!.blocks as unknown[]).freeform;
    expect(JSON.stringify(freeform)).toContain("my own line");
    expect(JSON.stringify(freeform)).not.toContain("Written by an agent.");
  });

  it("is a no-op merge when nothing changed underneath", () => {
    const merged = mergeAgentEditsIntoTask({ content: base }, base);
    expect(JSON.stringify(splitTaskNote(merged!.blocks as unknown[]).freeform)).toBe(
      JSON.stringify(splitTaskNote(base).freeform),
    );
  });

  it("returns null when the stored note has no blocks", () => {
    expect(mergeAgentEditsIntoTask({ content: "# markdown" }, base)).toBeNull();
    expect(mergeAgentEditsIntoTask({}, base)).toBeNull();
  });
});
