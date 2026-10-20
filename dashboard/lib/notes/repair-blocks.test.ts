import { describe, expect, it } from "vitest";
import { repairNoteBlocks, type RepairableBlock } from "./repair-blocks";

const t = (text: string, styles: Record<string, unknown> = {}) => ({ type: "text", text, styles });

describe("repairNoteBlocks", () => {
  it("empties a bullet that only says [ ] and turns [ ] text into a checkbox", () => {
    const out = repairNoteBlocks([
      { id: "a", type: "bulletListItem", props: {}, content: [t("[]")], children: [] },
      { id: "b", type: "bulletListItem", props: {}, content: [t("[x] shipped")], children: [] },
      { id: "c", type: "paragraph", props: {}, content: [t("-")], children: [] },
    ]);
    expect(out[0]).toMatchObject({ type: "bulletListItem", content: [] });
    expect(out[1]).toMatchObject({ type: "checkListItem", props: { checked: true }, content: [{ text: "shipped" }] });
    expect(out[2]).toMatchObject({ type: "bulletListItem", content: [] });
  });

  it("returns the same array when nothing needs repair", () => {
    const blocks = [{ type: "bulletListItem", content: [t("normal")], children: [] }];
    expect(repairNoteBlocks(blocks)).toBe(blocks);
  });

  it("repairs nested children and keeps untouched siblings by identity", () => {
    const sibling = { type: "paragraph", content: [t("keep")], children: [] };
    const out = repairNoteBlocks<RepairableBlock>([
      sibling,
      { type: "bulletListItem", content: [t("x")], children: [{ type: "paragraph", content: [t("-")], children: [] }] },
    ]);
    expect(out[0]).toBe(sibling);
    expect(out[1].children?.[0]).toMatchObject({ type: "bulletListItem" });
  });

  it("keeps a lone [x] as an empty checked checkbox instead of dropping the tick", () => {
    const [block] = repairNoteBlocks<RepairableBlock>([{ type: "bulletListItem", props: { textColor: "red" }, content: [t("[X]")], children: [] }]);
    expect(block).toMatchObject({ type: "checkListItem", props: { textColor: "red", checked: true }, content: [] });
  });

  it("keeps styled and linked spans after the marker", () => {
    const link = { type: "link", href: "https://example.com/a", content: [t("docs")] };
    const [block] = repairNoteBlocks<RepairableBlock>([
      { type: "bulletListItem", content: [t("[ ] "), t("bold", { bold: true }), t(" and "), link], children: [] },
    ]);
    expect(block).toMatchObject({ type: "checkListItem", props: { checked: false } });
    expect(block.content).toEqual([t("bold", { bold: true }), t(" and "), link]);
  });

  it("finds the marker when it is split across spans", () => {
    const [block] = repairNoteBlocks<RepairableBlock>([
      { type: "bulletListItem", content: [t("["), t(" ] "), t("later", { italic: true })], children: [] },
    ]);
    expect(block.type).toBe("checkListItem");
    expect(block.content).toEqual([t("later", { italic: true })]);
  });

  it("leaves a marker followed only by a link, and ordinary brackets, alone", () => {
    const blocks = [
      { type: "bulletListItem", content: [t("[ ]"), { type: "link", href: "x", content: [t("y")] }], children: [] },
      { type: "bulletListItem", content: [t("[ref] see below")], children: [] },
      { type: "bulletListItem", content: [t("[ ]nospace")], children: [] },
      { type: "paragraph", content: [t("- not empty")], children: [] },
      { type: "paragraph", content: [t("-"), t("x", { bold: true })], children: [] },
    ];
    expect(repairNoteBlocks(blocks)).toBe(blocks);
  });

  it("keeps children of a repaired block", () => {
    const child = { type: "paragraph", content: [t("child")], children: [] };
    const [block] = repairNoteBlocks<RepairableBlock>([{ type: "bulletListItem", content: [t("[ ] task")], children: [child] }]);
    expect(block.type).toBe("checkListItem");
    expect(block.children).toEqual([child]);
  });

  it("is idempotent", () => {
    const once = repairNoteBlocks<RepairableBlock>([
      { type: "bulletListItem", content: [t("[ ]")], children: [] },
      { type: "bulletListItem", content: [t("[x]")], children: [] },
      { type: "bulletListItem", content: [t("[ ] a")], children: [] },
      { type: "paragraph", content: [t("-")], children: [] },
    ]);
    expect(repairNoteBlocks(once)).toBe(once);
  });

  it("does not mutate its input", () => {
    const input: RepairableBlock[] = [{ type: "bulletListItem", content: [t("[ ] a")], children: [] }];
    const snapshot = JSON.stringify(input);
    repairNoteBlocks(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("handles a large note in one cheap pass", () => {
    const blocks: RepairableBlock[] = Array.from({ length: 20_000 }, (_, i) => ({
      type: "bulletListItem",
      content: [t(i % 100 === 0 ? "[ ] todo" : `line ${i}`)],
      children: [],
    }));
    const started = performance.now();
    const out = repairNoteBlocks(blocks);
    expect(performance.now() - started).toBeLessThan(500);
    expect(out.filter((b) => b.type === "checkListItem")).toHaveLength(200);
    expect(out[1]).toBe(blocks[1]);
  });
});
