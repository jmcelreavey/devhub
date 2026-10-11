import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CORE_THEME_PRESETS, THEME_PRESETS } from "@/lib/theme-presets";
import { PLUGIN_THEME_PRESETS } from "@/lib/plugin-branding.generated";

/**
 * The picker renders `darkSwatch` / `lightSwatch` as the preview chip, but the
 * palette itself lives in globals.css. Nothing structurally ties the two
 * together, so a palette edit that forgets the swatch produces a picker that
 * shows the wrong colour — visible only to someone who happens to compare.
 *
 * These tests read the real stylesheet and compare.
 */
const pluginCss = path.join(process.cwd(), "app/plugin-branding.generated.css");
const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8") +
  (fs.existsSync(pluginCss) ? fs.readFileSync(pluginCss, "utf8") : "");

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
  it("pins the default and Halloween themes before the remaining core presets", () => {
    expect(CORE_THEME_PRESETS.map((preset) => preset.id)).toEqual([
      "graphite", "hollow", "forest", "midnight", "tokyo", "catppuccin",
    ]);
  });

  it("shares the core order with every theme list and appends plugins in declaration order", () => {
    const coreIds = new Set<string>(CORE_THEME_PRESETS.map((preset) => preset.id));
    expect(THEME_PRESETS).toEqual([
      ...CORE_THEME_PRESETS,
      ...PLUGIN_THEME_PRESETS.filter((preset) => !coreIds.has(preset.id)),
    ]);
  });

  it.each([
    ["graphite", "Graphite Neon (Default)", "DevHub's default: charcoal + lime"],
    ["hollow", "Hollow (Halloween) 🎃", "Spooky Halloween theme, switches on automatically in October"],
  ])("explains %s without changing its saved id", (id, label, description) => {
    expect(CORE_THEME_PRESETS.find((preset) => preset.id === id)).toMatchObject({ id, label, description });
  });

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

/** WCAG relative luminance for the opaque palette tokens. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

describe("AA text and controls across every core surface", () => {
  for (const preset of CORE_THEME_PRESETS) {
    it.each(["dark", "light"] as const)(`${preset.id} %s keeps all text at 4.5:1 and controls at 3:1`, mode => {
      for (const surface of ["--bg", "--bg-sidebar", "--bg-surface", "--bg-elevated", "--bg-overlay"]) {
        const background = tokenFor(mode, preset.id, surface)!;
        for (const token of ["--text", "--text-muted", "--text-subtle", "--accent-text", "--accent-text-hover", "--success", "--warning", "--danger", "--info"]) {
          const foreground = tokenFor(mode, preset.id, token)!;
          expect(foreground, `${preset.id} ${mode} ${token}`).toMatch(/^#[0-9a-f]{6}$/i);
          const ratio = (Math.max(luminance(foreground), luminance(background)) + .05) / (Math.min(luminance(foreground), luminance(background)) + .05);
          expect(ratio, `${preset.id} ${mode} ${token} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
        const border = tokenFor(mode, preset.id, preset.id === "graphite" ? "--graphite-control-border" : "--control-border")!;
        const ratio = (Math.max(luminance(border), luminance(background)) + .05) / (Math.min(luminance(border), luminance(background)) + .05);
        expect(ratio, `${preset.id} ${mode} controls on ${surface}`).toBeGreaterThanOrEqual(3);
      }
    });
  }
});

describe("primary button contrast", () => {
  for (const preset of THEME_PRESETS) {
    it.each(["dark", "light"] as const)(`${preset.id} %s keeps normal and hover text at 4.5:1 or better`, (mode) => {
      const foreground = tokenFor(mode, preset.id, "--accent-fg");
      expect(foreground).toMatch(/^#[0-9a-f]{6}$/i);
      for (const token of ["--accent", "--accent-hover"]) {
        const background = tokenFor(mode, preset.id, token);
        expect(background).toMatch(/^#[0-9a-f]{6}$/i);
        const light = luminance(foreground!);
        const dark = luminance(background!);
        expect((Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05), `${preset.id} ${mode} ${token}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
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
