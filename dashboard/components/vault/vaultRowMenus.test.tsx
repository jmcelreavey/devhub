/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { buildVaultFileMenuGroups } from "@/components/vault/vaultRowMenus";

const base = {
  itemLabel: "diagram",
  kind: "diagrams" as const,
  onOpen: vi.fn(),
  onCopyLocation: vi.fn(),
  onDelete: vi.fn(),
};

describe("buildVaultFileMenuGroups", () => {
  it("keeps Open and Delete groups", () => {
    const groups = buildVaultFileMenuGroups(base);
    expect(groups.map((group) => group.id)).toEqual(["open", "share", "danger"]);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(["open"]);
    expect(groups[2]?.items[0]?.id).toBe("delete");
    expect(groups[2]?.items[0]?.danger).toBe(true);
  });

  it("groups work, sharing and organisation before deletion", () => {
    const groups = buildVaultFileMenuGroups({
      ...base, onCreateTasksFrom: vi.fn(), onRename: vi.fn(), onMove: vi.fn(),
    });
    expect(groups.map((group) => group.label ?? group.id)).toEqual(["Open", "Work", "Copy and share", "Organise", "danger"]);
    expect(groups.flatMap((group) => group.items.map((item) => item.id))).toEqual([
      "open", "spawn-tasks-from-plan", "copy", "rename", "move", "delete",
    ]);
  });

  it("shows disabled Open in Cursor when a reason is given", () => {
    const groups = buildVaultFileMenuGroups({
      ...base,
      cursorDisabledReason: "Open in Cursor is for notes linked to a repo.",
    });
    const cursor = groups[0]?.items.find((item) => item.id === "cursor");
    expect(cursor?.disabled).toBe(true);
    expect(cursor?.disabledReason).toBe("Open in Cursor is for notes linked to a repo.");
  });

  it("omits Open in Cursor when neither handler nor reason is set", () => {
    const groups = buildVaultFileMenuGroups(base);
    expect(groups[0]?.items.some((item) => item.id === "cursor")).toBe(false);
  });

  it("includes share extras for diagrams when handlers exist", () => {
    const groups = buildVaultFileMenuGroups({
      ...base,
      onCopyMarkdown: vi.fn(),
      onShare: vi.fn(),
      onOneTime: vi.fn(),
    });
    expect(groups.find((group) => group.id === "share")?.items.map((item) => item.id)).toEqual(
      expect.arrayContaining(["copy", "markdown", "share", "one-time"]),
    );
  });
});
