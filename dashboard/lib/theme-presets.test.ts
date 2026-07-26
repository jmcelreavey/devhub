import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CORE_THEME_PRESETS } from "@/lib/theme-presets";

/**
 * The picker renders `darkSwatch` / `lightSwatch` as the preview chip, but the
 * palette itself lives in globals.css. Nothing structurally ties the two
 * together, so a palette edit that forgets the swatch produces a picker that
 * shows the wrong colour — visible only to someone who happens to compare.
 *
 * These tests read the real stylesheet and compare.
 */
const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");

/** A named custom property declared in a given preset/mode block. */
function tokenFor(mode: "dark" | "light", preset: string, token: string): string | null {
  // Blocks are plain and hand-written; a scoped regex beats pulling in a parser.
  const selector = new RegExp(
    `:root\\[data-theme="${mode}"\\]\\[data-theme-preset="${preset}"\\][^{]*\\{([^}]*)\\}`,
  );
  const block = css.match(selector);
  if (!block) return null;
  const found = block[1].match(new RegExp(`${token}:\\s*([^;]+);`));
  return found ? found[1].trim() : null;
}

function bgFor(mode: "dark" | "light", preset: string): string | null {
  return tokenFor(mode, preset, "--bg");
}

describe("core theme presets", () => {
  it.each(CORE_THEME_PRESETS.map((p) => [p.id, p] as const))(
    "%s declares both modes in globals.css",
    (id) => {
      expect(bgFor("dark", id), `no dark block for ${id}`).not.toBeNull();
      expect(bgFor("light", id), `no light block for ${id}`).not.toBeNull();
    },
  );

  it.each(CORE_THEME_PRESETS.map((p) => [p.id, p] as const))(
    "%s swatches match the stylesheet",
    (id, preset) => {
      expect(bgFor("dark", id)).toBe(preset.darkSwatch);
      expect(bgFor("light", id)).toBe(preset.lightSwatch);
    },
  );

  it.each(CORE_THEME_PRESETS.map((p) => [p.id, p] as const))(
    "%s accents match the stylesheet",
    (id, preset) => {
      expect(tokenFor("dark", id, "--accent")).toBe(preset.darkAccent);
      expect(tokenFor("light", id, "--accent")).toBe(preset.lightAccent);
    },
  );

  it("gives every preset a distinct accent in each mode", () => {
    // The picker chip is background + accent; identical accents would put two
    // presets back to looking the same in the list.
    for (const mode of ["darkAccent", "lightAccent"] as const) {
      const accents = CORE_THEME_PRESETS.map((p) => p[mode].toLowerCase());
      expect(new Set(accents).size, `${mode} collision`).toBe(accents.length);
    }
  });

  it("gives every preset a distinct dark background", () => {
    // The complaint that prompted the redesign: they all looked the same.
    const swatches = CORE_THEME_PRESETS.map((p) => p.darkSwatch.toLowerCase());
    expect(new Set(swatches).size).toBe(swatches.length);
  });

  it("spreads the dark backgrounds across more than one hue family", () => {
    // Guards against drifting back to five near-identical neutral darks.
    const hues = CORE_THEME_PRESETS.map((p) => hueOf(p.darkSwatch));
    const chromatic = hues.filter((h) => h !== null) as number[];
    // At least three distinct hue buckets (60-degree bins) among the tinted ones.
    const buckets = new Set(chromatic.map((h) => Math.floor(h / 60)));
    expect(buckets.size).toBeGreaterThanOrEqual(3);
  });

  it("has unique ids and labels", () => {
    const ids = CORE_THEME_PRESETS.map((p) => p.id);
    const labels = CORE_THEME_PRESETS.map((p) => p.label);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

/** Hue in degrees, or null for a effectively achromatic colour. */
function hueOf(hex: string): number | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 0.02) return null; // neutral greys have no meaningful hue
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}
