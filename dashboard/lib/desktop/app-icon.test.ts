/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { desktopIconKind, subscribeDesktopAppIcon, syncDesktopAppIcon } from "./app-icon";
import { isDesktop, setDesktopIcon } from "./bridge";
import { applyThemeSelection, syncSeasonalTheme } from "@/lib/theme-presets";

vi.mock("@/lib/brand-mark", () => ({ HAS_PLUGIN_BRAND: true }));
vi.mock("./bridge", () => ({
  isDesktop: vi.fn(() => true),
  setDesktopIcon: vi.fn().mockResolvedValue(undefined),
}));

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.documentElement.setAttribute("data-theme-preset", "graphite");
  await syncDesktopAppIcon("__devhub__");
  localStorage.clear();
  vi.clearAllMocks();
});

describe("desktop icon synchronisation", () => {
  it("applies the bootstrapped theme and follows runtime changes until unmounted", async () => {
    document.documentElement.setAttribute("data-theme-preset", "hollow");
    const unsubscribe = subscribeDesktopAppIcon("__devhub__");
    expect(setDesktopIcon).toHaveBeenLastCalledWith("halloween");
    applyThemeSelection({ preset: "graphite", mode: "light" });
    expect(setDesktopIcon).toHaveBeenLastCalledWith("default");
    applyThemeSelection({ preset: "hollow", mode: "dark" });
    expect(setDesktopIcon).toHaveBeenLastCalledWith("halloween");
    unsubscribe();
    vi.mocked(setDesktopIcon).mockClear();
    applyThemeSelection({ preset: "graphite", mode: "dark" });
    expect(setDesktopIcon).not.toHaveBeenCalled();
  });

  it("restores the BI icon after Hollow and ignores a stale BI download", async () => {
    let finishFetch!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finishFetch = resolve; })));
    document.documentElement.setAttribute("data-theme-preset", "graphite");
    const pending = syncDesktopAppIcon("__bottle__");
    document.documentElement.setAttribute("data-theme-preset", "hollow");
    await syncDesktopAppIcon("__bottle__");
    const response = { ok: true, arrayBuffer: async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer } as Response;
    finishFetch(response);
    await pending;
    expect(setDesktopIcon).toHaveBeenCalledExactlyOnceWith("halloween");

    vi.mocked(fetch).mockResolvedValue(response);
    document.documentElement.setAttribute("data-theme-preset", "graphite");
    await syncDesktopAppIcon("__bottle__");
    expect(setDesktopIcon).toHaveBeenLastCalledWith("plugin", new Uint8Array(await response.arrayBuffer()));
  });

  it("restores the icon when the October season ends in an open app", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 20, 12));
    localStorage.setItem("devhub:theme-preset", "graphite");
    syncSeasonalTheme();
    const unsubscribe = subscribeDesktopAppIcon("__devhub__");
    expect(setDesktopIcon).toHaveBeenLastCalledWith("halloween");
    vi.setSystemTime(new Date(2026, 10, 1, 12));
    syncSeasonalTheme();
    expect(setDesktopIcon).toHaveBeenLastCalledWith("default");
    unsubscribe();
  });

  it("restores the previous brand for a decorative icon and falls back if BI is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await syncDesktopAppIcon("__devhub__");
    document.documentElement.setAttribute("data-theme-preset", "hollow");
    await syncDesktopAppIcon("Rocket");
    expect(setDesktopIcon).toHaveBeenLastCalledWith("halloween");
    document.documentElement.setAttribute("data-theme-preset", "graphite");
    await syncDesktopAppIcon("Rocket");
    expect(setDesktopIcon).toHaveBeenLastCalledWith("default");
    await syncDesktopAppIcon("__bottle__");
    expect(setDesktopIcon).toHaveBeenLastCalledWith("default");
  });

  it("does nothing in a browser", async () => {
    vi.mocked(isDesktop).mockReturnValueOnce(false);
    await syncDesktopAppIcon("__devhub__");
    expect(setDesktopIcon).not.toHaveBeenCalled();
  });
});

describe("desktopIconKind", () => {
  it("resets to the bundled DevHub icon when the user picks the DevHub logo", () => {
    expect(desktopIconKind("__devhub__", true)).toBe("default");
    expect(desktopIconKind("__devhub__", false)).toBe("default");
  });

  it("uses the plugin icon for the active brand logo when a plugin brand exists", () => {
    expect(desktopIconKind("__bottle__", true)).toBe("plugin");
    expect(desktopIconKind("__bottle__", false)).toBe("default");
  });

  it("treats a missing preference as the active brand", () => {
    expect(desktopIconKind("", true)).toBe("plugin");
    expect(desktopIconKind("", false)).toBe("default");
  });

  it("prioritises Halloween over every logo choice", () => {
    for (const stored of ["__devhub__", "__bottle__", "", "Rocket", "__seasonal__"]) {
      expect(desktopIconKind(stored, true, "hollow")).toBe("halloween");
      expect(desktopIconKind(stored, false, "hollow")).toBe("halloween");
    }
  });

  it("leaves Lucide and seasonal picks alone", () => {
    expect(desktopIconKind("Rocket", true)).toBeNull();
    expect(desktopIconKind("__seasonal__", true)).toBeNull();
  });
});
