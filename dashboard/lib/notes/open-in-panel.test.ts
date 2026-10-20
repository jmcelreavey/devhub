/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { NOTES_OPEN_PATH_EVENT, openNoteHrefInPanel, wantsFullPage } from "./open-in-panel";

const listener = vi.fn();
afterEach(() => { window.removeEventListener(NOTES_OPEN_PATH_EVENT, listener); listener.mockReset(); });

it("routes note hrefs to the side panel and leaves other hrefs to the caller", () => {
  window.addEventListener(NOTES_OPEN_PATH_EVENT, listener);
  expect(openNoteHrefInPanel("/notes/task-notes/My%20task?x=1")).toBe(true);
  expect((listener.mock.calls[0]![0] as CustomEvent).detail).toEqual({ path: "task-notes/My task" });
  expect(openNoteHrefInPanel("/work?tab=tasks")).toBe(false);
  expect(listener).toHaveBeenCalledOnce();
});

it("keeps full-page navigation for modified and middle clicks", () => {
  expect(wantsFullPage({ button: 0 })).toBe(false);
  for (const event of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { button: 1 }]) expect(wantsFullPage(event)).toBe(true);
});
