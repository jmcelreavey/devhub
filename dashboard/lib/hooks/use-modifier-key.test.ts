import { describe, expect, it } from "vitest";
import { shortcutLabel } from "./use-modifier-key";

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
