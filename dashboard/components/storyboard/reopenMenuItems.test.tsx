import { describe, expect, it, vi } from "vitest";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { isClosedCard, reopenMenuGroup } from "./reopenMenuItems";

const card = (fields: Partial<BoardCard>) => ({ taskId: "t1", status: "done", taskDone: true, ...fields }) as BoardCard;

describe("reopenMenuGroup", () => {
  it("offers nothing on open tasks", () => {
    expect(isClosedCard(card({ status: "in-progress", taskDone: false }))).toBe(false);
    expect(reopenMenuGroup(card({ status: "in-progress", taskDone: false }), vi.fn())).toBeNull();
  });
  it("offers Reopen, plus Reopen and address feedback when the task has a PR", () => {
    expect(reopenMenuGroup(card({}), vi.fn())?.items.map((item) => item.label)).toEqual(["Reopen"]);
    const group = reopenMenuGroup(card({ prUrl: "https://github.com/o/r/pull/1" }), vi.fn());
    expect(group?.items.map((item) => [item.label, item.disabled ?? false])).toEqual([["Reopen", false], ["Reopen and address feedback", true]]);
  });
  it("offers only Create follow-up task when the PR merged", () => {
    const onSelect = vi.fn();
    const group = reopenMenuGroup(card({ prUrl: "https://github.com/o/r/pull/1", prState: "merged" }), onSelect);
    expect(group?.items.map((item) => item.label)).toEqual(["Create follow-up task"]);
    group?.items[0].onSelect?.();
    expect(onSelect).toHaveBeenCalledWith("follow-up");
  });
});
