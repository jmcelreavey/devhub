import { describe, it, expect } from "vitest";
import { collectCheckboxBlocks } from "./note-task-sync";

describe("collectCheckboxBlocks", () => {
  it("collects top-level checkboxes with text and checked state", () => {
    const blocks = [
      { id: "1", type: "checkListItem", props: { checked: false }, content: [{ type: "text", text: "Do a thing" }] },
      { id: "2", type: "paragraph", content: [{ type: "text", text: "not a task" }] },
      { id: "3", type: "checkListItem", props: { checked: true }, content: [{ type: "text", text: "Done thing" }] },
    ];
    const result = collectCheckboxBlocks(blocks);
    expect(result).toEqual([
      { id: "1", text: "Do a thing", checked: false },
      { id: "3", text: "Done thing", checked: true },
    ]);
  });

  it("recurses into children and skips empty checkboxes", () => {
    const blocks = [
      {
        id: "a",
        type: "toggleListItem",
        content: [{ type: "text", text: "group" }],
        children: [
          { id: "b", type: "checkListItem", props: {}, content: [{ type: "text", text: "nested" }] },
          { id: "c", type: "checkListItem", props: {}, content: [{ type: "text", text: "   " }] },
        ],
      },
    ];
    expect(collectCheckboxBlocks(blocks)).toEqual([{ id: "b", text: "nested", checked: false }]);
  });
});
