/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";

interface TestDomModule {
  JSDOM: new (html: string, options: { url: string }) => { window: { document: Document; localStorage: Storage } };
}

const { JSDOM } = createRequire(import.meta.url)("jsdom") as TestDomModule;
const { window } = new JSDOM("", { url: "https://theme.test" });
const { document, localStorage } = window;
import { CORE_THEME_PRESETS, DEFAULT_THEME_PRESET_ID, sanitizePreset } from "./theme-presets";
import { GRAPHITE_EFFECT_DEFAULTS } from "./graphite-theme";
import { HOLLOW_EFFECT_DEFAULTS, hollowRuntimePlan, parseHollowEffects } from "./hollow-theme";
import { THEME_EFFECTS, applyThemeEffectsDom, effectEnabled, parseThemeEffects, themeEffectDefaults } from "./theme-effects";

it("declares a distinct identity and the complete effects contract for every core theme", () => {
  expect(new Set(Object.values(THEME_EFFECTS).map(theme => theme.mark)).size).toBe(CORE_THEME_PRESETS.length);
  for (const preset of CORE_THEME_PRESETS) {
    expect(preset.effects).toBe(THEME_EFFECTS[preset.id]);
    const effects = preset.effects.effects;
    expect(new Set(effects.map(effect => effect.id)).size).toBe(effects.length);
    for (const id of ["loader", "interaction", "celebrations", "cursor"]) expect(effects.some(effect => effect.id === id)).toBe(true);
    for (const effect of effects) {
      expect(effect.label).toBeTruthy();
      expect(effect.description).toBeTruthy();
      expect(typeof effect.default).toBe("boolean");
      expect(["static", "off", "unchanged"]).toContain(effect.reducedMotion);
      for (const dependency of effect.requires ?? []) expect(effects.some(effect => effect.id === dependency)).toBe(true);
    }
  }
});

it("preserves every legacy boolean, including explicit offs, without moving storage keys", () => {
  for (const [preset, legacy] of [["graphite", GRAPHITE_EFFECT_DEFAULTS], ["hollow", HOLLOW_EFFECT_DEFAULTS]] as const) {
    expect(THEME_EFFECTS[preset].storageKey).toBe(`devhub:${preset}-effects`);
    for (const value of [true, false]) {
      const saved = Object.fromEntries(Object.keys(legacy).map(key => [key, value]));
      expect(parseThemeEffects(preset, JSON.stringify(saved))).toMatchObject(saved);
    }
  }
  expect(parseThemeEffects("hollow", '{"interaction":false,"sound":true}')).toMatchObject({ interaction: false, cursor: false, sound: true });
  expect(parseHollowEffects('{"interaction":false}').cursor).toBe(false);
  expect(hollowRuntimePlan({ ...HOLLOW_EFFECT_DEFAULTS, interaction: false, cursor: true }, true).cursorTrail).toBe(true);
});

it.each([null, "bad json", "[]", "null", '{"master":"false","cursor":0}'])("validates malformed preferences: %s", raw => {
  expect(parseThemeEffects("forest", raw)).toEqual(themeEffectDefaults("forest"));
});

it("keeps the pinned ids and falls back safely for retired or unknown ids", () => {
  expect(sanitizePreset("graphite")).toBe("graphite");
  expect(sanitizePreset("hollow")).toBe("hollow");
  expect(sanitizePreset("retired-theme")).toBe(DEFAULT_THEME_PRESET_ID);
});

it("applies the declared reduced-motion policy, dependencies and master switch", () => {
  for (const preset of CORE_THEME_PRESETS) {
    const defaults = themeEffectDefaults(preset.id);
    for (const effect of preset.effects.effects) {
      expect(effectEnabled(preset.id, defaults, effect.id, false)).toBe(effect.default && effect.reducedMotion !== "off");
      expect(effectEnabled(preset.id, { ...defaults, master: false }, effect.id, true)).toBe(false);
    }
  }
  expect(effectEnabled("hollow", { ...themeEffectDefaults("hollow"), creatures: false }, "rareEvents", true)).toBe(false);
});

it("removes stale DOM flags on theme changes and when a plugin declares no effects", () => {
  const root = document.createElement("div");
  applyThemeEffectsDom(root, "graphite", themeEffectDefaults("graphite"), true);
  applyThemeEffectsDom(root, "forest", themeEffectDefaults("forest"), false);
  expect(root.hasAttribute("data-theme-fx-grid")).toBe(false);
  expect(root.getAttribute("data-theme-fx-cursor")).toBe("off");
  expect(root.getAttribute("data-theme-fx-ambient")).toBe("on");
  applyThemeEffectsDom(root, "plugin", {}, true);
  expect(root.getAttributeNames()).toEqual([]);
});

describe("first-paint bootstrap", () => {
  it.each(CORE_THEME_PRESETS)("survives minification and preserves $id preferences", preset => {
    localStorage.clear();
    const root = document.documentElement;
    root.setAttribute("data-theme-preset", preset.id);
    localStorage.setItem(preset.effects.storageKey, '{"master":true,"cursor":false}');
    const bundle = buildSync({ entryPoints: ["lib/theme-effects.ts"], bundle: true, minify: true, write: false, format: "iife", globalName: "ThemeModule" }).outputFiles[0].text;
    const compiled = new Function(`${bundle};return ThemeModule;`)() as { getThemeEffectsBootstrapScript(): string };
    const script = compiled.getThemeEffectsBootstrapScript();
    new Function("window", "document", "localStorage", script)({ matchMedia: () => ({ matches: true }) }, document, localStorage);
    expect(root.getAttribute("data-theme-fx-cursor")).toBe("off");
    expect(root.getAttribute("data-theme-fx-loader")).toBe("on");
    expect(localStorage.getItem(preset.effects.storageKey)).toBe('{"master":true,"cursor":false}');
  });
});
