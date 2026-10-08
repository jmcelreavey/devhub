import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import {
  HOLLOW_SEASON_KEY, overrideHollowSeason, parseHollowSeason, resolveHollowSeason,
  type HollowSeasonSelection, type HollowSeasonState,
} from "./hollow-theme";
import { getThemeBootstrapInlineScript } from "./theme-presets";

const previous: HollowSeasonSelection = { preset: "tokyo", mode: "system" };
const october = (day = 1, year = 2026) => new Date(year, 9, day);

describe("October default", () => {
  it.each([1, 17, 31])("switches on the first open on October %s, preserving the mode", (day) => {
    const result = resolveHollowSeason(october(day), previous, null);
    expect(result.selection).toEqual({ preset: "hollow", mode: "system" });
    expect(result.state).toEqual({ year: 2026, previous, overridden: false, restored: false });
  });

  it("respects a manual override throughout October and afterwards", () => {
    const first = resolveHollowSeason(october(), previous, null);
    const state = overrideHollowSeason(october(3), first.state);
    const manual: HollowSeasonSelection = { preset: "forest", mode: "light" };
    expect(resolveHollowSeason(october(17), manual, state).selection).toEqual(manual);
    expect(resolveHollowSeason(new Date(2026, 10, 1), manual, state).selection).toEqual(manual);
  });

  it("restores the previous preset with the current mode after a mode-only change", () => {
    const first = resolveHollowSeason(october(), previous, null);
    const manual: HollowSeasonSelection = { preset: "hollow", mode: "light" };
    expect(resolveHollowSeason(october(17), manual, first.state).selection).toEqual(manual);
    expect(resolveHollowSeason(new Date(2026, 10, 1), manual, first.state).selection)
      .toEqual({ preset: "tokyo", mode: "light" });
  });

  it("keeps Hollow when deliberately selected again after another preset", () => {
    const first = resolveHollowSeason(october(), previous, null);
    const overridden = overrideHollowSeason(october(3), first.state);
    const manual: HollowSeasonSelection = { preset: "hollow", mode: "dark" };
    expect(resolveHollowSeason(new Date(2026, 10, 1), manual, overridden).selection).toEqual(manual);
  });

  it("restores the preset exactly once after October", () => {
    const first = resolveHollowSeason(october(), previous, null);
    const november = resolveHollowSeason(new Date(2026, 10, 1), first.selection, first.state);
    expect(november.selection).toEqual(previous);
    expect(november.state?.restored).toBe(true);
    const manual: HollowSeasonSelection = { preset: "hollow", mode: "system" };
    expect(resolveHollowSeason(new Date(2026, 11, 1), manual, november.state).selection).toEqual(manual);
  });

  it("switches again next year, including if no open happened between Octobers", () => {
    const first = resolveHollowSeason(october(), previous, null);
    const next = resolveHollowSeason(october(17, 2027), first.selection, first.state);
    expect(next.state).toMatchObject({ year: 2027, previous, overridden: false });
    const manual: HollowSeasonSelection = { preset: "forest", mode: "dark" };
    const overridden = overrideHollowSeason(october(2), first.state);
    expect(resolveHollowSeason(october(1, 2027), manual, overridden).state?.previous).toEqual(manual);
  });

  it("leaves someone already on Hollow alone in October and November", () => {
    const current: HollowSeasonSelection = { preset: "hollow", mode: "light" };
    const first = resolveHollowSeason(october(), current, null);
    expect(first.selection).toEqual(current);
    expect(first.state?.previous).toBeNull();
    expect(resolveHollowSeason(new Date(2026, 10, 1), current, first.state).selection).toEqual(current);
  });

  it("does nothing outside October and rejects damaged stored state", () => {
    expect(resolveHollowSeason(new Date(2026, 8, 30), previous, null)).toEqual({ selection: previous, state: null });
    for (const raw of ["bad", "null", "[]", '{"year":2026}', JSON.stringify({
      year: 2026, previous: { preset: "unknown", mode: "light" }, overridden: false, restored: false,
    })]) expect(parseHollowSeason(raw, ["hollow", "tokyo"])).toBeNull();
  });
});

describe("pre-paint seasonal bootstrap", () => {
  function boot(date: string, values: Map<string, string>) {
    const attrs = new Map<string, string>();
    const root = { getAttribute: (k: string) => attrs.get(k) ?? null, setAttribute: (k: string, v: string) => attrs.set(k, v), removeAttribute: (k: string) => attrs.delete(k) };
    runInNewContext(getThemeBootstrapInlineScript(), {
      document: { documentElement: root }, URLSearchParams,
      window: { location: { search: `?hollowNow=${date}` }, matchMedia: () => ({ matches: true }) },
      localStorage: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) },
    });
    return attrs;
  }

  it("sets DOM, stored selection and effect attributes before React runs; restores in November", () => {
    const values = new Map([["devhub:theme", "system"], ["devhub:theme-preset", "tokyo"]]);
    const attrs = boot("2026-10-01", values);
    expect(attrs.get("data-theme-preset")).toBe("hollow");
    expect(attrs.get("data-theme-mode")).toBe("system");
    expect(attrs.get("data-theme")).toBe("dark");
    expect(attrs.get("data-hollow-fx")).toBe("on");
    expect(values.get("devhub:theme-preset")).toBe("hollow");
    values.set("devhub:theme", "light");
    const restored = boot("2026-11-01", values);
    expect(restored.get("data-theme-preset")).toBe("tokyo");
    expect(restored.get("data-theme-mode")).toBe("light");
  });

  it("does not reapply Hollow after a saved override, even on a fresh document", () => {
    const values = new Map([["devhub:theme", "dark"], ["devhub:theme-preset", "tokyo"]]);
    boot("2026-10-01", values);
    const state = JSON.parse(values.get(HOLLOW_SEASON_KEY)!) as HollowSeasonState;
    values.set(HOLLOW_SEASON_KEY, JSON.stringify(overrideHollowSeason(october(2), state)));
    values.set("devhub:theme-preset", "forest");
    expect(boot("2026-10-17", values).get("data-theme-preset")).toBe("forest");
    expect(boot("2026-11-01", values).get("data-theme-preset")).toBe("forest");
  });
});
