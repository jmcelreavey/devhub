/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GRAPHITE_EFFECT_DEFAULTS, GRAPHITE_EFFECTS_KEY } from "@/lib/graphite-theme";
import { GraphiteGate } from "./GraphiteGate";
import { updateGraphiteEffects } from "./useGraphiteEffects";

vi.mock("next/dynamic", () => ({
  default: () => function Runtime() { return <div data-testid="graphite-runtime" />; },
}));

function matchMedia(reduced = false) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced && query.includes("reduce"), media: query,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
}

describe("Graphite effect lifecycle", () => {
  beforeEach(() => {
    matchMedia();
    localStorage.clear();
    document.body.removeAttribute("data-motion");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-theme-mode", "dark");
    document.documentElement.setAttribute("data-theme-preset", "graphite");
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });
  afterEach(cleanup);

  it("mounts only on Graphite and strips stale attributes when the theme changes", () => {
    render(<GraphiteGate />);
    expect(screen.getByTestId("graphite-runtime")).toBeTruthy();
    act(() => {
      document.documentElement.setAttribute("data-theme-preset", "hollow");
      window.dispatchEvent(new Event("devhub:theme-change"));
    });
    expect(screen.queryByTestId("graphite-runtime")).toBeNull();
    expect([...document.documentElement.attributes].some(attr => attr.name.startsWith("data-graphite-"))).toBe(false);
  });

  it("turns off immediately, preserving the individual settings", () => {
    render(<GraphiteGate />);
    act(() => updateGraphiteEffects({ master: false }));
    expect(screen.queryByTestId("graphite-runtime")).toBeNull();
    expect(document.documentElement.getAttribute("data-graphite-loader")).toBe("off");
    act(() => updateGraphiteEffects({ master: true }));
    expect(screen.getByTestId("graphite-runtime")).toBeTruthy();
  });

  it.each(["reduced", "hidden", "kill"])("has no effect runtime with %s motion", mode => {
    if (mode === "reduced") matchMedia(true);
    if (mode === "hidden") Object.defineProperty(document, "hidden", { configurable: true, value: true });
    if (mode === "kill") document.body.setAttribute("data-motion", "off");
    localStorage.setItem(GRAPHITE_EFFECTS_KEY, JSON.stringify({ ...GRAPHITE_EFFECT_DEFAULTS, cursor: true }));
    render(<GraphiteGate />);
    expect(screen.queryByTestId("graphite-runtime")).toBeNull();
    expect(document.documentElement.getAttribute("data-graphite-motion")).toBe("off");
    expect(document.documentElement.getAttribute("data-graphite-grid")).toBe("on");
  });

  it("responds to motion being disabled while the page is open", async () => {
    render(<GraphiteGate />);
    expect(screen.getByTestId("graphite-runtime")).toBeTruthy();
    await act(async () => { document.body.setAttribute("data-motion", "off"); });
    expect(screen.queryByTestId("graphite-runtime")).toBeNull();
    expect(document.documentElement.getAttribute("data-graphite-motion")).toBe("off");
  });

  it("does not subscribe to motion on other themes", () => {
    document.documentElement.setAttribute("data-theme-preset", "tokyo");
    render(<GraphiteGate />);
    expect(screen.queryByTestId("graphite-runtime")).toBeNull();
    expect(window.matchMedia).not.toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
  });

  it("honours cross-tab preference changes", () => {
    render(<GraphiteGate />);
    act(() => {
      localStorage.setItem(GRAPHITE_EFFECTS_KEY, '{"master":false}');
      window.dispatchEvent(new StorageEvent("storage", { key: GRAPHITE_EFFECTS_KEY }));
    });
    expect(screen.queryByTestId("graphite-runtime")).toBeNull();
  });
});
