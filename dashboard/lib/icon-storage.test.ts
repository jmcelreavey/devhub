import { describe, expect, it } from "vitest";
import {
  decodePinnedGlyph,
  encodePinnedGlyph,
  isFullColorGlyphStored,
  isPinnedGlyphStored,
  pinnedGlyphMatchesEntry,
} from "./icon-storage";

describe("icon-storage", () => {
  it("round-trips unicode emoji", () => {
    const encoded = encodePinnedGlyph({
      icon: "PartyPopper",
      label: "New Year",
      emoji: "🎉",
      markId: "confettiPop",
    });
    expect(isPinnedGlyphStored(encoded)).toBe(true);
    const decoded = decodePinnedGlyph(encoded);
    expect(decoded).toEqual({
      v: 1,
      icon: "PartyPopper",
      label: "New Year",
      emoji: "🎉",
      markId: "confettiPop",
    });
    expect(isFullColorGlyphStored(encoded)).toBe(true);
  });

  it("matches seasonal entry fields", () => {
    const s = encodePinnedGlyph({ icon: "Heart", label: "Valentine's Day", emoji: "💘" });
    expect(pinnedGlyphMatchesEntry(s, { icon: "Heart", label: "Valentine's Day", emoji: "💘" })).toBe(true);
    expect(pinnedGlyphMatchesEntry(s, { icon: "Heart", label: "Valentine's Day", emoji: "❤️" })).toBe(false);
  });

  it("rejects invalid payloads", () => {
    expect(decodePinnedGlyph("Terminal")).toBeNull();
    expect(decodePinnedGlyph("__dh_glyph_v1__:!!!")).toBeNull();
    expect(isFullColorGlyphStored("Terminal")).toBe(false);
  });
});
