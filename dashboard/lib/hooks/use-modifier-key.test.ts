import { describe, expect, it } from "vitest";
import { controlShortcutLabel, shortcutLabel } from "./use-modifier-key";

describe("shortcutLabel", () => {
  it("uses symbols on a Mac", () => {
    expect(shortcutLabel("⌘", "P")).toBe("⌘P");
    expect(shortcutLabel("⌘", "O", true)).toBe("⌘⇧O");
  });
  it("spells the chord out elsewhere, so Windows never shows a Mac key", () => {
    expect(shortcutLabel("Ctrl+", "P")).toBe("Ctrl+P");
    expect(shortcutLabel("Ctrl+", "O", true)).toBe("Ctrl+Shift+O");
  });
});

describe("controlShortcutLabel", () => {
  it("uses the Control glyph on a Mac", () => {
    expect(controlShortcutLabel(true, "`")).toBe("⌃`");
  });
  it("spells Control out on other platforms", () => {
    expect(controlShortcutLabel(false, "`")).toBe("Ctrl+`");
  });
});
