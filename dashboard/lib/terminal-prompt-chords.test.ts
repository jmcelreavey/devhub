import { describe, expect, it } from "vitest";
import { isAskChord } from "./terminal-prompt-chords";

const press = (init: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }>) => ({ key: "Enter", metaKey: false, ctrlKey: false, shiftKey: false, ...init });

describe("isAskChord", () => {
  it("accepts Cmd+Shift+Enter and, for Windows and Linux, Ctrl+Shift+Enter", () => {
    expect(isAskChord(press({ metaKey: true, shiftKey: true }))).toBe(true);
    expect(isAskChord(press({ ctrlKey: true, shiftKey: true }))).toBe(true);
  });
  it("leaves plain, Shift and Ctrl+Enter alone", () => {
    expect(isAskChord(press({}))).toBe(false);
    expect(isAskChord(press({ shiftKey: true }))).toBe(false);
    expect(isAskChord(press({ ctrlKey: true }))).toBe(false);
    expect(isAskChord(press({ key: "a", ctrlKey: true, shiftKey: true }))).toBe(false);
  });
});
