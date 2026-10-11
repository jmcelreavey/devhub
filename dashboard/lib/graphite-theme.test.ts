/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GRAPHITE_EFFECT_DEFAULTS, GRAPHITE_EFFECTS_KEY, GRAPHITE_CELEBRATE_EVENT,
  applyGraphiteDom, getGraphiteBootstrapScript, observeGraphiteMerge, parseGraphiteEffects } from "./graphite-theme";

describe("Graphite preferences and first paint", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.setAttribute("data-theme-preset", "graphite");
  });

  it.each([null, "invalid", "null", "42", "[]"])("recovers from invalid storage: %s", raw => {
    expect(parseGraphiteEffects(raw)).toEqual(GRAPHITE_EFFECT_DEFAULTS);
  });

  it("accepts only boolean preferences", () => {
    expect(parseGraphiteEffects('{"grid":false,"cursor":"true","loader":0,"unknown":true}'))
      .toEqual({ ...GRAPHITE_EFFECT_DEFAULTS, grid: false });
  });

  it("defaults the follower on and preserves existing cursor choices", () => {
    expect(parseGraphiteEffects(null).cursor).toBe(true);
    expect(parseGraphiteEffects('{"grid":false}').cursor).toBe(true);
    expect(parseGraphiteEffects('{"cursor":true}').cursor).toBe(true);
    expect(parseGraphiteEffects('{"cursor":false}').cursor).toBe(false);
    window.eval(getGraphiteBootstrapScript());
    expect(document.documentElement.getAttribute("data-graphite-cursor")).toBe("on");
  });

  it("master off wins before first paint without overwriting individual choices", () => {
    localStorage.setItem(GRAPHITE_EFFECTS_KEY, JSON.stringify({ master: false, cursor: true }));
    window.eval(getGraphiteBootstrapScript());
    for (const key of Object.keys(GRAPHITE_EFFECT_DEFAULTS)) {
      expect(document.documentElement.getAttribute(`data-graphite-${key.toLowerCase()}`)).toBe("off");
    }
    expect(parseGraphiteEffects(localStorage.getItem(GRAPHITE_EFFECTS_KEY)).cursor).toBe(true);
  });

  it("bootstrap and runtime agree for every switch, and remove all flags for Hollow", () => {
    const effects = { ...GRAPHITE_EFFECT_DEFAULTS, grid: false, cursor: true };
    localStorage.setItem(GRAPHITE_EFFECTS_KEY, JSON.stringify(effects));
    window.eval(getGraphiteBootstrapScript());
    const before = document.documentElement.outerHTML;
    applyGraphiteDom(document.documentElement, "graphite", effects);
    expect(document.documentElement.outerHTML).toBe(before);
    applyGraphiteDom(document.documentElement, "hollow", effects);
    expect([...document.documentElement.attributes].filter(attr => attr.name.startsWith("data-graphite-"))).toHaveLength(0);
  });

  it("does not celebrate historical merges or repeat a transition from multiple task rows", () => {
    const listener = vi.fn();
    window.addEventListener(GRAPHITE_CELEBRATE_EVENT, listener);
    observeGraphiteMerge({ runId: "historical", prState: "merged" });
    expect(listener).not.toHaveBeenCalled();
    observeGraphiteMerge({ runId: "new-merge", prState: "open" });
    observeGraphiteMerge({ runId: "new-merge", prState: "merged" });
    observeGraphiteMerge({ runId: "new-merge", prState: "merged" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toBe("merge");
    window.removeEventListener(GRAPHITE_CELEBRATE_EVENT, listener);
  });
});
