/** @vitest-environment jsdom */
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOLLOW_EFFECTS_EVENT, HOLLOW_EFFECTS_KEY, HOLLOW_EFFECT_DEFAULTS } from "@/lib/hollow-theme";
import { HOLLOW_FAVICON_ID, HollowGate } from "@/components/hollow/HollowGate";

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockHollowRuntime() {
      return <div data-testid="hollow-runtime" />;
    },
}));

function installMatchMedia(reduced = false) {
  window.matchMedia = ((query: string) => ({
    matches: reduced && query.includes("reduce"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

function setPreset(preset: string) {
  document.documentElement.setAttribute("data-theme", "dark");
  document.documentElement.setAttribute("data-theme-mode", "dark");
  document.documentElement.setAttribute("data-theme-preset", preset);
}

describe("HollowGate", () => {
  beforeEach(() => {
    installMatchMedia();
    localStorage.clear();
    document.body.removeAttribute("data-motion");
    for (const name of [...document.documentElement.attributes].map((attr) => attr.name)) {
      if (name.startsWith("data-hollow")) document.documentElement.removeAttribute(name);
    }
  });

  it("does not mount effects for another preset and clears stale attributes", () => {
    document.documentElement.setAttribute("data-hollow-fx", "on");
    setPreset("graphite");
    render(<HollowGate />);
    expect(screen.queryByTestId("hollow-runtime")).toBeNull();
    expect(document.documentElement.hasAttribute("data-hollow-fx")).toBe(false);
  });

  it("mounts for Hollow with jump scares and sound off", () => {
    setPreset("hollow");
    render(<HollowGate />);
    expect(screen.getByTestId("hollow-runtime")).toBeTruthy();
    expect(document.documentElement.getAttribute("data-hollow-fx")).toBe("on");
    expect(document.documentElement.getAttribute("data-hollow-jump")).toBe("off");
    expect(document.documentElement.getAttribute("data-hollow-sound")).toBe("off");
  });

  it("preserves an editing pause when effect preferences change", () => {
    setPreset("hollow");
    render(<><input autoFocus /><HollowGate /></>);
    expect(document.documentElement.hasAttribute("data-hollow-paused")).toBe(true);
    act(() => {
      localStorage.setItem(HOLLOW_EFFECTS_KEY, JSON.stringify({ ...HOLLOW_EFFECT_DEFAULTS, creatures: false }));
      window.dispatchEvent(new Event(HOLLOW_EFFECTS_EVENT));
    });
    expect(document.documentElement.hasAttribute("data-hollow-paused")).toBe(true);
  });

  it("stays unmounted when the master switch is off", () => {
    localStorage.setItem(
      HOLLOW_EFFECTS_KEY,
      JSON.stringify({ ...HOLLOW_EFFECT_DEFAULTS, master: false }),
    );
    setPreset("hollow");
    render(<HollowGate />);
    expect(screen.queryByTestId("hollow-runtime")).toBeNull();
    expect([...document.documentElement.attributes].some((attr) => attr.name.startsWith("data-hollow-"))).toBe(false);
  });
  it("uses the Halloween mark as the tab icon only while Hollow is selected", () => {
    setPreset("hollow");
    const view = render(<HollowGate />);
    const link = document.getElementById(HOLLOW_FAVICON_ID) as HTMLLinkElement | null;
    expect(link?.rel).toBe("icon");
    expect(link?.getAttribute("href")).toBe("/hollow/brand-mark-dark.svg");
    view.unmount();
    expect(document.getElementById(HOLLOW_FAVICON_ID)).toBeNull();

    setPreset("graphite");
    render(<HollowGate />);
    expect(document.getElementById(HOLLOW_FAVICON_ID)).toBeNull();
  });
});
