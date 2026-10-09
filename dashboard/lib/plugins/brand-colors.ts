/**
 * Turns the two colours a person picks for a plugin's branding into readable
 * light and dark palettes. Pure: the generator preview and the scaffold use
 * the same numbers, so what is previewed is what is written.
 */

export type Rgb = [number, number, number];

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHexColour(value: string): boolean {
  return HEX.test(value.trim());
}

export function parseHex(value: string): Rgb | null {
  const text = value.trim();
  if (!HEX.test(text)) return null;
  return [1, 3, 5].map((i) => Number.parseInt(text.slice(i, i + 2), 16)) as Rgb;
}

export function toHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, "0")).join("")}`;
}

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(rgb: Rgb): number {
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function fromHsl([h, s, l]: [number, number, number]): Rgb {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255];
}

/** Move lightness toward `direction` in 1% steps until `ok` holds. Null when it never does. */
function shiftUntil(rgb: Rgb, direction: 1 | -1, ok: (candidate: Rgb) => boolean): Rgb | null {
  const [h, s, l] = toHsl(rgb);
  for (let step = 0; step <= 100; step += 1) {
    const lightness = l + (direction * step) / 100;
    if (lightness < 0 || lightness > 1) return null;
    // Judge the 8-bit colour that will actually be written, not the unrounded one.
    const candidate = fromHsl([h, s, lightness]).map(Math.round) as Rgb;
    if (ok(candidate)) return candidate;
  }
  return null;
}

const SURFACES = {
  dark: { bg: "#111416", surface: "#191e23", elevated: "#232a31", overlay: "#2d3640" },
  light: { bg: "#f7f8f9", surface: "#ffffff", elevated: "#ffffff", overlay: "#e5eaf0" },
} as const;

const INK = { dark: parseHex("#101827") as Rgb, white: [255, 255, 255] as Rgb };

export interface ModePalette {
  accent: string;
  accentHover: string;
  accentText: string;
  accentTextHover: string;
  accentDim: string;
  accentFg: string;
  /** True when the exact colour chosen was not readable here and was adjusted. */
  adjusted: boolean;
}

export interface BrandPalette {
  dark: ModePalette;
  light: ModePalette;
}

/**
 * Readable text on every surface of one mode: contrast against the surface
 * that gives the least.
 */
function readableText(colour: Rgb, mode: "dark" | "light"): { rgb: Rgb; adjusted: boolean } {
  const surfaces = Object.values(SURFACES[mode]).map((hex) => parseHex(hex) as Rgb);
  const worst = (candidate: Rgb) => Math.min(...surfaces.map((surface) => contrast(candidate, surface)));
  if (worst(colour) >= 4.5) return { rgb: colour, adjusted: false };
  const found = shiftUntil(colour, mode === "dark" ? 1 : -1, (candidate) => worst(candidate) >= 4.5);
  return { rgb: found ?? (mode === "dark" ? [255, 255, 255] : [0, 0, 0]), adjusted: true };
}

/** A fill that reads as a boundary on every surface, with text on it that reads too. */
function readableFill(colour: Rgb, mode: "dark" | "light"): { fill: Rgb; text: Rgb; adjusted: boolean } {
  const surfaces = Object.values(SURFACES[mode]).map((hex) => parseHex(hex) as Rgb);
  const boundary = (candidate: Rgb) => Math.min(...surfaces.map((surface) => contrast(candidate, surface))) >= 3;
  let fill = colour;
  let adjusted = false;
  if (!boundary(fill)) {
    fill = shiftUntil(fill, mode === "dark" ? 1 : -1, boundary) ?? fill;
    adjusted = true;
  }
  const best = (candidate: Rgb) => (contrast(candidate, INK.dark) >= contrast(candidate, INK.white) ? INK.dark : INK.white);
  let text = best(fill);
  if (contrast(fill, text) < 4.5) {
    // Move the fill away from the text colour until the label reads.
    const direction = text === INK.dark ? 1 : -1;
    const moved = shiftUntil(fill, direction, (candidate) => contrast(candidate, best(candidate)) >= 4.5 && boundary(candidate));
    if (moved) {
      fill = moved;
      text = best(fill);
    }
    adjusted = true;
  }
  return { fill, text, adjusted };
}

function shade(rgb: Rgb, mode: "dark" | "light"): Rgb {
  const [h, s, l] = toHsl(rgb);
  return fromHsl([h, s, Math.max(0, Math.min(1, l + (mode === "dark" ? 0.08 : -0.08)))]);
}

function modePalette(primary: Rgb, accentText: Rgb, mode: "dark" | "light"): ModePalette {
  const fill = readableFill(primary, mode);
  const text = readableText(accentText, mode);
  const [r, g, b] = fill.fill.map(Math.round);
  return {
    accent: toHex(fill.fill),
    accentHover: toHex(shade(fill.fill, mode)),
    accentText: toHex(text.rgb),
    accentTextHover: toHex(shade(text.rgb, mode)),
    accentDim: `rgb(${r} ${g} ${b} / ${mode === "dark" ? 16 : 10}%)`,
    accentFg: toHex(fill.text),
    adjusted: fill.adjusted || text.adjusted,
  };
}

export const DEFAULT_PRIMARY = "#2454A6";
export const DEFAULT_ACCENT_TEXT = "#6D28D9";

/** Palettes for both modes. Returns null for a colour that is not a six-digit hex value. */
export function derivePalette(primaryHex: string, accentTextHex: string): BrandPalette | null {
  const primary = parseHex(primaryHex);
  const accent = parseHex(accentTextHex);
  if (!primary || !accent) return null;
  return { dark: modePalette(primary, accent, "dark"), light: modePalette(primary, accent, "light") };
}

export const MODE_SURFACES = SURFACES;
