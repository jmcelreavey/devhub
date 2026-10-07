import { describe, expect, it } from "vitest";
import { groupTasksByParent } from "./group-by-parent";

const epic = (key: string) => ({ key, summary: `${key} summary` });

describe("groupTasksByParent", () => {
  it("groups by first appearance and keeps task order inside each group", () => {
    const parents: Record<string, ReturnType<typeof epic> | undefined> = {
      a: epic("EPIC-2"),
      b: epic("EPIC-1"),
      c: epic("EPIC-2"),
      d: epic("EPIC-1"),
    };
    const groups = groupTasksByParent(["a", "b", "c", "d"], (id) => parents[id]);

    expect(groups.map((g) => [g.parent?.key, g.tasks])).toEqual([
      ["EPIC-2", ["a", "c"]],
      ["EPIC-1", ["b", "d"]],
    ]);
  });

  it("trails tasks without a parent as a single group", () => {
    const groups = groupTasksByParent(["a", "loose", "b"], (id) => (id === "loose" ? null : epic("EPIC-1")));

    expect(groups.map((g) => [g.parent?.key ?? null, g.tasks])).toEqual([
      ["EPIC-1", ["a", "b"]],
      [null, ["loose"]],
    ]);
  });

  it("returns no groups for no tasks", () => {
    expect(groupTasksByParent([], () => null)).toEqual([]);
  });
});
