import { describe, expect, it } from "vitest";
import { textToBlocks, blocksToText } from "../markdown-convert/index.ts";
import { applyTaskNoteOp, parseTaskNoteOp, readTaskNote, splitTaskNote } from "./sections.ts";

const statusUpdate = { summary: "The search plan is ready.", whatChanged: "Added a scoped plan.", currentState: "Waiting for approval.", nextStep: "Approve or revise the plan." };

describe("structured task status", () => {
  it("upserts context without changing the plan, personal blocks or workflow status", () => {
    const original = textToBlocks('# Search\n\n```task-meta\n{"status":"planning"}\n```\n\n## Plan\n\nKeep these steps.\n\n## My notes\n\nKeep **my** words.');
    const result = applyTaskNoteOp(original, { op: "set_status_update", statusUpdate });
    expect(readTaskNote(result.blocks)).toMatchObject({ statusUpdate, meta: { status: "planning" } });
    expect(splitTaskNote(result.blocks).freeform).toEqual(splitTaskNote(original).freeform);
    expect(blocksToText(result.blocks).match(/^## Status$/gm)).toHaveLength(1);
    expect(applyTaskNoteOp(result.blocks, { op: "set_status_update", statusUpdate }).changed).toBe(false);
    const next = applyTaskNoteOp(result.blocks, { op: "set_status_update", statusUpdate: { ...statusUpdate, summary: "Implementation finished." } });
    expect(blocksToText(next.blocks)).not.toContain("The search plan is ready.");
    expect(readTaskNote(textToBlocks(blocksToText(next.blocks))).statusUpdate?.summary).toBe("Implementation finished.");
  });

  it("rejects missing fields and keeps bounded values as plain text", () => {
    expect(parseTaskNoteOp({ op: "set_status_update", statusUpdate: { summary: "Only one field" } }).ok).toBe(false);
    const long = "x".repeat(1000);
    const result = applyTaskNoteOp([], { op: "set_status_update", statusUpdate: { ...statusUpdate, summary: long, whatChanged: "## Not a heading\n\nJust context" } });
    expect(readTaskNote(result.blocks).statusUpdate).toMatchObject({ summary: long, whatChanged: "## Not a heading Just context" });
  });

  it("exposes the latest attached image while leaving legacy media intact", () => {
    let blocks = applyTaskNoteOp([], { op: "add_media", assetPath: "task-notes/assets/first.png", kind: "image" }).blocks;
    blocks = applyTaskNoteOp(blocks, { op: "add_media", assetPath: "task-notes/assets/last.png", kind: "image", caption: "Updated layout" }).blocks;
    blocks = applyTaskNoteOp(blocks, { op: "add_media", assetPath: "task-notes/assets/movie.mp4", kind: "video" }).blocks;
    const view = readTaskNote(blocks);
    expect(view.media).toHaveLength(3);
    expect(view.latestScreenshot).toMatchObject({ url: expect.stringContaining("last.png"), caption: "Updated layout" });
    expect(view.statusUpdate).toBeUndefined();
    expect(readTaskNote(textToBlocks("# Old task\n\n## Summary\n\nOld context.")).statusUpdate).toBeUndefined();
  });
});
