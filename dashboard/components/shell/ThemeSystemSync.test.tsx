/** @vitest-environment jsdom */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeSystemSync } from "./ThemeSystemSync";
import { applyThemeSelection, syncSeasonalTheme } from "@/lib/theme-presets";
import { HOLLOW_SEASON_KEY } from "@/lib/hollow-theme";

describe("seasonal preference persistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 30, 23, 59, 59));
    localStorage.clear();
    localStorage.setItem("devhub:theme", "system");
    localStorage.setItem("devhub:theme-preset", "tokyo");
    document.documentElement.setAttribute("data-theme-mode", "system");
    document.documentElement.setAttribute("data-theme-preset", "tokyo");
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("switches a tab left open on October 1 and restores on November resume", () => {
    render(<ThemeSystemSync />);
    act(() => { vi.advanceTimersByTime(1100); });
    expect(document.documentElement.getAttribute("data-theme-preset")).toBe("hollow");
    act(() => { vi.setSystemTime(new Date(2026, 10, 1)); window.dispatchEvent(new Event("focus")); });
    expect(document.documentElement.getAttribute("data-theme-preset")).toBe("tokyo");
    expect(localStorage.getItem("devhub:theme")).toBe("system");
  });

  it("records real picker writes as overrides but leaves automatic OS changes alone", () => {
    vi.setSystemTime(new Date(2026, 9, 1));
    syncSeasonalTheme();
    applyThemeSelection({ preset: "hollow", mode: "system" }, { persist: false });
    expect(JSON.parse(localStorage.getItem(HOLLOW_SEASON_KEY)!).overridden).toBe(false);
    applyThemeSelection({ preset: "forest", mode: "light" });
    expect(JSON.parse(localStorage.getItem(HOLLOW_SEASON_KEY)!).overridden).toBe(true);
    vi.setSystemTime(new Date(2026, 9, 17));
    syncSeasonalTheme();
    expect(document.documentElement.getAttribute("data-theme-preset")).toBe("forest");
    vi.setSystemTime(new Date(2026, 10, 1));
    syncSeasonalTheme();
    expect(document.documentElement.getAttribute("data-theme-preset")).toBe("forest");
    expect(document.documentElement.getAttribute("data-theme-mode")).toBe("light");
  });

  it("keeps mode-only changes seasonal and restores the preset with the current mode", () => {
    vi.setSystemTime(new Date(2026, 9, 1));
    syncSeasonalTheme();
    applyThemeSelection({ preset: "hollow", mode: "light" });
    expect(JSON.parse(localStorage.getItem(HOLLOW_SEASON_KEY)!).overridden).toBe(false);
    vi.setSystemTime(new Date(2026, 9, 17));
    syncSeasonalTheme();
    expect(document.documentElement.getAttribute("data-theme-preset")).toBe("hollow");
    vi.setSystemTime(new Date(2026, 10, 1));
    syncSeasonalTheme();
    expect(document.documentElement.getAttribute("data-theme-preset")).toBe("tokyo");
    expect(localStorage.getItem("devhub:theme")).toBe("light");
  });

  it("keeps Hollow in November if selected again after another preset", () => {
    vi.setSystemTime(new Date(2026, 9, 1));
    syncSeasonalTheme();
    applyThemeSelection({ preset: "forest", mode: "system" });
    applyThemeSelection({ preset: "hollow", mode: "light" });
    vi.setSystemTime(new Date(2026, 10, 1));
    syncSeasonalTheme();
    expect(document.documentElement.getAttribute("data-theme-preset")).toBe("hollow");
    expect(localStorage.getItem("devhub:theme")).toBe("light");
  });

  it("syncs a manual choice from another tab and cleans up its timer", () => {
    vi.setSystemTime(new Date(2026, 9, 1));
    const view = render(<ThemeSystemSync />);
    const state = JSON.parse(localStorage.getItem(HOLLOW_SEASON_KEY)!);
    localStorage.setItem(HOLLOW_SEASON_KEY, JSON.stringify({ ...state, overridden: true }));
    localStorage.setItem("devhub:theme-preset", "forest");
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: "devhub:theme-preset" })); });
    expect(document.documentElement.getAttribute("data-theme-preset")).toBe("forest");
    view.unmount();
    act(() => { vi.advanceTimersByTime(500); });
    expect(vi.getTimerCount()).toBe(0);
  });
});
