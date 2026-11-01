/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";

interface TestDomModule {
  JSDOM: new (html: string, options: { url: string }) => { window: { document: Document; localStorage: Storage } };
}

const { JSDOM } = createRequire(import.meta.url)("jsdom") as TestDomModule;
const { window } = new JSDOM("", { url: "https://theme.test" });
const { document, localStorage } = window;
import { applyThemeSelection, CORE_DEFAULT_THEME_PRESET_ID, CORE_THEME_PRESETS, DEFAULT_THEME_PRESET_ID, getThemeBootstrapInlineScript, syncSeasonalTheme } from "./themes/presets";
import { HOLLOW_SEASON_KEY, getHollowSeasonBootstrapScript, parseHollowSeason, resolveHollowSeason } from "./hollow-theme";
import { THEME_EFFECTS, applyThemeEffectsDom, canMountPluginThemeEffects, effectEnabled, parseThemeEffects, themeEffectDefaults } from "./theme-effects";

it("declares a distinct identity and the complete effects contract for every core theme", () => {
  expect(new Set(CORE_THEME_PRESETS.map(preset => preset.effects.mark)).size).toBe(CORE_THEME_PRESETS.length);
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


it.each([null, "bad json", "[]", "null", '{"master":"false","cursor":0}'])("validates malformed preferences: %s", raw => {
  expect(parseThemeEffects("forest", raw)).toEqual(themeEffectDefaults("forest"));
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

it("does not mount trusted plugin effects when the host motion or master switch is off", () => {
  expect(canMountPluginThemeEffects("winter", true, true)).toBe(true);
  expect(canMountPluginThemeEffects("winter", false, true)).toBe(false);
  expect(canMountPluginThemeEffects("winter", true, false)).toBe(false);
  expect(canMountPluginThemeEffects("winter", false, false)).toBe(false);
  expect(canMountPluginThemeEffects("graphite", true, true)).toBe(false);
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

describe("unavailable preset preferences", () => {
  const browser = { location: { search: "" }, matchMedia: () => ({ matches: false }), dispatchEvent: () => true };

  function bootstrap(date: string) {
    browser.location.search = `?hollowNow=${date}`;
    new Function("window", "document", "localStorage", getThemeBootstrapInlineScript())(browser, document, localStorage);
  }

  function setup(preset: string) {
    localStorage.clear();
    localStorage.setItem("devhub:theme-preset", preset);
    localStorage.setItem("devhub:theme", "dark");
    vi.stubGlobal("window", browser);
    vi.stubGlobal("document", document);
    vi.stubGlobal("localStorage", localStorage);
  }

  afterEach(() => vi.unstubAllGlobals());

  it("does not switch to an unavailable Hollow preset in October", () => {
    setup("forest");
    browser.location.search = "?hollowNow=2026-10-15";
    const script = getHollowSeasonBootstrapScript(["graphite", "forest"]);
    new Function("window", "localStorage", `var p="devhub:theme-preset",m="devhub:theme",preset=localStorage.getItem(p),setting=localStorage.getItem(m);${script}`)(browser, localStorage);
    expect(localStorage.getItem("devhub:theme-preset")).toBe("forest");
    expect(localStorage.getItem(HOLLOW_SEASON_KEY)).toBeNull();
  });


  it.each(["2026-10-15", "2026-11-15"])("preserves the saved preset and season when Hollow is unavailable on %s", date => {
    setup("hollow");
    const season = { year: 2026, previous: { preset: "forest", mode: "dark" as const }, overridden: false, restored: false };
    localStorage.setItem(HOLLOW_SEASON_KEY, JSON.stringify(season));
    browser.location.search = `?hollowNow=${date}`;
    const script = getHollowSeasonBootstrapScript(["graphite", "forest"]);
    new Function("window", "localStorage", `var p="devhub:theme-preset",m="devhub:theme",preset=localStorage.getItem(p),setting=localStorage.getItem(m);${script}`)(browser, localStorage);
    expect(localStorage.getItem("devhub:theme-preset")).toBe("hollow");
    expect(JSON.parse(localStorage.getItem(HOLLOW_SEASON_KEY) ?? "null")).toEqual(season);
    expect(resolveHollowSeason(new Date(date + "T12:00:00"), { preset: "hollow", mode: "dark" }, season, false)).toEqual({ selection: { preset: "hollow", mode: "dark" }, state: season });
  });

  it("keeps an unavailable preset through first paint, reconciliation and mode changes", () => {
    setup("winter-pack");
    bootstrap("2026-11-15");
    expect(document.documentElement.getAttribute("data-theme-preset")).toBe(CORE_DEFAULT_THEME_PRESET_ID);
    expect(localStorage.getItem("devhub:theme-preset")).toBe("winter-pack");
    syncSeasonalTheme();
    applyThemeSelection({ mode: "light", preset: DEFAULT_THEME_PRESET_ID }, { preserveUnavailablePreset: true, notify: false });
    expect(localStorage.getItem("devhub:theme-preset")).toBe("winter-pack");
    expect(localStorage.getItem("devhub:theme")).toBe("light");
    applyThemeSelection({ mode: "light", preset: DEFAULT_THEME_PRESET_ID }, { notify: false });
    expect(localStorage.getItem("devhub:theme-preset")).toBe(DEFAULT_THEME_PRESET_ID);
  });







  it("preserves an unavailable preset in the minified first-paint script", () => {
    setup("winter-pack");
    browser.location.search = "?hollowNow=2026-10-15";
    const bundle = buildSync({ entryPoints: ["lib/themes/presets.ts"], bundle: true, minify: true, write: false, format: "iife", globalName: "ThemeModule" }).outputFiles[0].text;
    const compiled = new Function(`${bundle};return ThemeModule;`)() as { getThemeBootstrapInlineScript(): string };
    new Function("window", "document", "localStorage", compiled.getThemeBootstrapInlineScript())(browser, document, localStorage);
    expect(document.documentElement.getAttribute("data-theme-preset")).toBe(CORE_DEFAULT_THEME_PRESET_ID);
    expect(localStorage.getItem(HOLLOW_SEASON_KEY)).toBeNull();
    browser.location.search = "?hollowNow=2026-11-01";
    new Function("window", "document", "localStorage", compiled.getThemeBootstrapInlineScript())(browser, document, localStorage);
    expect(localStorage.getItem("devhub:theme-preset")).toBe("winter-pack");
    expect(document.documentElement.getAttribute("data-theme-preset")).toBe(CORE_DEFAULT_THEME_PRESET_ID);
  });


  it("rejects malformed stored ids and Hollow state", () => {
    setup("../winter");
    bootstrap("2026-11-15");
    expect(localStorage.getItem("devhub:theme-preset")).toBe(DEFAULT_THEME_PRESET_ID);
    expect(parseHollowSeason(JSON.stringify({ year: 2026, previous: { preset: "../winter", mode: "dark" }, overridden: false, restored: false }), ["hollow"])).toBeNull();
  });
});
