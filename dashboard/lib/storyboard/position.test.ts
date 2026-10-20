import { describe, expect, it } from "vitest";
import type { BoardCard } from "./notes-board-shared";
import { planPosition } from "./position";

const card = (taskId: string, status: string, rank?: string) => ({ taskId, status, ...(rank ? { rank } : {}) }) as unknown as BoardCard;
const cards = [card("a", "todo", "c"), card("b", "todo", "m"), card("c", "todo", "t"), card("z", "done", "c")];

describe("planPosition", () => {
  it("places a card before or after another in its column, or at the top or bottom", () => {
    const before = planPosition(cards, { taskId: "c", before: "b" });
    expect(before).toHaveLength(1);
    expect(before[0]!.rank > "c" && before[0]!.rank < "m").toBe(true);
    expect(planPosition(cards, { taskId: "a", after: "c" })[0]!.rank > "t").toBe(true);
    expect(planPosition(cards, { taskId: "c", to: "top" })[0]!.rank < "c").toBe(true);
    expect(planPosition(cards, { taskId: "c", to: "bottom" })).toEqual([]);
    expect(planPosition(cards, { taskId: "a", rank: "zz" })).toEqual([{ taskId: "a", rank: "zz" }]);
  });

  it("refuses a missing card, an anchor in another column, a bad rank or no position", () => {
    expect(() => planPosition(cards, { taskId: "nope", to: "top" })).toThrow(/No card/);
    expect(() => planPosition(cards, { taskId: "a", before: "z" })).toThrow(/isn't another card/);
    expect(() => planPosition(cards, { taskId: "a", rank: "A0" })).toThrow(/rank must be/);
    expect(() => planPosition(cards, { taskId: "a" })).toThrow(/Give before/);
  });
});
