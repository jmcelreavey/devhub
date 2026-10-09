import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCENT_TEXT,
  DEFAULT_PRIMARY,
  MODE_SURFACES,
  contrast,
  derivePalette,
  isHexColour,
  luminance,
  parseHex,
  toHex,
  type ModePalette,
} from "./brand-colors";

const rgb = (hex: string) => parseHex(hex) as [number, number, number];

function expectReadable(palette: ModePalette, mode: "dark" | "light") {
  const surfaces = Object.values(MODE_SURFACES[mode]).map(rgb);
  for (const surface of surfaces) {
    expect(contrast(rgb(palette.accentText), surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(palette.accent), surface)).toBeGreaterThanOrEqual(3);
  }
  expect(contrast(rgb(palette.accentFg), rgb(palette.accent))).toBeGreaterThanOrEqual(4.5);
}

describe("colour maths", () => {
  it("matches the WCAG reference ratios", () => {
    expect(contrast(rgb("#000000"), rgb("#ffffff"))).toBeCloseTo(21, 5);
    expect(contrast(rgb("#ffffff"), rgb("#ffffff"))).toBeCloseTo(1, 5);
    expect(luminance(rgb("#ffffff"))).toBeCloseTo(1, 5);
  });

  it("only accepts six-digit hex", () => {
    expect(isHexColour("#2454A6")).toBe(true);
    expect(isHexColour(" #2454a6 ")).toBe(true);
    for (const bad of ["2454A6", "#245", "#2454A6FF", "rgb(1,2,3)", "red", "#ggg000", ""]) expect(isHexColour(bad)).toBe(false);
    expect(parseHex("#2454a6")).toEqual([0x24, 0x54, 0xa6]);
    expect(toHex([0x24, 0x54, 0xa6])).toBe("#2454a6");
  });
});

describe("derivePalette", () => {
  it("returns null for anything that is not a hex colour", () => {
    expect(derivePalette("blue", DEFAULT_ACCENT_TEXT)).toBeNull();
    expect(derivePalette(DEFAULT_PRIMARY, "#12")).toBeNull();
  });

  it("makes the default colours readable in both modes", () => {
    const palette = derivePalette(DEFAULT_PRIMARY, DEFAULT_ACCENT_TEXT);
    expect(palette).not.toBeNull();
    if (!palette) return;
    expectReadable(palette.dark, "dark");
    expectReadable(palette.light, "light");
  });

  it("leaves an already readable colour as it was", () => {
    const palette = derivePalette(DEFAULT_PRIMARY, DEFAULT_ACCENT_TEXT);
    expect(palette?.light.accent).toBe("#2454a6");
    expect(palette?.light.accentText).toBe("#6d28d9");
    expect(palette?.light.adjusted).toBe(false);
  });

  it("adjusts and says so when a colour cannot be read as chosen", () => {
    const palette = derivePalette("#101010", "#0a0a0a");
    expect(palette?.dark.adjusted).toBe(true);
    if (palette) expectReadable(palette.dark, "dark");
  });

  it("holds for a spread of colours, including the awkward ones", () => {
    const samples = ["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#808080", "#7f7f7f", "#123456", "#fedcba", "#2454a6", "#6d28d9"];
    for (const primary of samples) {
      for (const accent of samples) {
        const palette = derivePalette(primary, accent);
        expect(palette).not.toBeNull();
        if (!palette) continue;
        expectReadable(palette.dark, "dark");
        expectReadable(palette.light, "light");
      }
    }
  });

  it("writes the translucent accent as an rgb() value", () => {
    const palette = derivePalette(DEFAULT_PRIMARY, DEFAULT_ACCENT_TEXT);
    expect(palette?.dark.accentDim).toMatch(/^rgb\(\d+ \d+ \d+ \/ 16%\)$/);
    expect(palette?.light.accentDim).toMatch(/^rgb\(\d+ \d+ \d+ \/ 10%\)$/);
  });
});
