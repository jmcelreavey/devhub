import { describe, expect, it } from "vitest";
import {
  isAppleTerminalPlatform,
  isTerminalCopyShortcut,
  isTerminalCutShortcut,
  isTerminalShiftPasteShortcut,
  resolveTerminalCopyText,
  selectionInPlaceDeleteSequence,
} from "./terminal-clipboard";

describe("terminal-clipboard shortcuts", () => {
  it("detects Apple platforms", () => {
    expect(isAppleTerminalPlatform("MacIntel", "")).toBe(true);
    expect(isAppleTerminalPlatform("Win32", "Windows")).toBe(false);
  });

  it("copies with ⌘C on Apple and Ctrl(+Shift)+C elsewhere", () => {
    expect(
      isTerminalCopyShortcut(
        { key: "c", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
        true,
      ),
    ).toBe(true);
    expect(
      isTerminalCopyShortcut(
        { key: "c", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false },
        false,
      ),
    ).toBe(true);
    expect(
      isTerminalCopyShortcut(
        { key: "c", metaKey: false, ctrlKey: true, altKey: false, shiftKey: true },
        false,
      ),
    ).toBe(true);
    expect(
      isTerminalCopyShortcut(
        { key: "c", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false },
        true,
      ),
    ).toBe(false);
  });

  it("cuts with ⌘/Ctrl+X", () => {
    expect(
      isTerminalCutShortcut(
        { key: "x", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
        true,
      ),
    ).toBe(true);
    expect(
      isTerminalCutShortcut(
        { key: "x", metaKey: false, ctrlKey: true, altKey: false, shiftKey: true },
        false,
      ),
    ).toBe(true);
  });

  it("shift-paste is Ctrl/⌘+Shift+V only", () => {
    expect(
      isTerminalShiftPasteShortcut(
        { key: "v", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true },
        true,
      ),
    ).toBe(true);
    expect(
      isTerminalShiftPasteShortcut(
        { key: "v", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
        true,
      ),
    ).toBe(false);
  });
});

describe("selectionInPlaceDeleteSequence", () => {
  it("emits DEL for a single-line selection ending at the cursor", () => {
    expect(
      selectionInPlaceDeleteSequence({
        selection: "foo",
        position: { start: { x: 2, y: 5 }, end: { x: 5, y: 5 } },
        cursorAbsY: 4,
        cursorX: 4,
      }),
    ).toBe("\x7f\x7f\x7f");
  });

  it("refuses multi-line or off-cursor selections", () => {
    expect(
      selectionInPlaceDeleteSequence({
        selection: "a\nb",
        position: { start: { x: 1, y: 1 }, end: { x: 2, y: 2 } },
        cursorAbsY: 1,
        cursorX: 1,
      }),
    ).toBeNull();
    expect(
      selectionInPlaceDeleteSequence({
        selection: "foo",
        position: { start: { x: 2, y: 5 }, end: { x: 5, y: 5 } },
        cursorAbsY: 9,
        cursorX: 4,
      }),
    ).toBeNull();
  });
});

describe("resolveTerminalCopyText", () => {
  it("prefers xterm selection over DOM", () => {
    expect(resolveTerminalCopyText("  term  ", "  dom  ")).toBe("term");
    expect(resolveTerminalCopyText("", "  dom  ")).toBe("dom");
  });
});
