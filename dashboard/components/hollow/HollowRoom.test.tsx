/** @vitest-environment jsdom */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLLOW_EFFECT_DEFAULTS, hollowRuntimePlan } from "@/lib/hollow-theme";
import { HollowRoom } from "./HollowRoom";

const originalAnimate = Element.prototype.animate;
const cancel = vi.fn();
describe("room events", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    Element.prototype.animate = vi.fn(() => ({ cancel }) as unknown as Animation);
    history.replaceState(null, "", "/");
  });
  afterEach(() => {
    cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); cancel.mockClear();
    Element.prototype.animate = originalAnimate;
    history.replaceState(null, "", "/");
  });

  it("runs a brief event every few minutes, resets on hide, and clears timers on unmount", () => {
    const view = render(<div className="hollow-fx"><HollowRoom plan={hollowRuntimePlan(HOLLOW_EFFECT_DEFAULTS, true)} /></div>);
    const root = view.container.firstElementChild!;
    act(() => { vi.advanceTimersByTime(179999); });
    expect(root.classList.contains("is-rare")).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(root.classList.contains("is-rare")).toBe(true);
    act(() => { vi.advanceTimersByTime(14000); });
    expect(root.classList.contains("is-rare")).toBe(false);
    act(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(vi.getTimerCount()).toBe(0);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("holds preview at peak but cannot bypass either rare-events off or reduced motion", () => {
    history.replaceState(null, "", "/?hollowRare=1");
    const view = render(<div className="hollow-fx"><HollowRoom plan={hollowRuntimePlan(HOLLOW_EFFECT_DEFAULTS, true)} /></div>);
    expect(view.container.firstElementChild!.classList.contains("is-rare-preview")).toBe(true);
    view.rerender(<div className="hollow-fx"><HollowRoom plan={hollowRuntimePlan({ ...HOLLOW_EFFECT_DEFAULTS, rareEvents: false }, true)} /></div>);
    expect(document.querySelector(".is-rare-preview, .hollow-passing-shadow")).toBeNull();
    view.rerender(<div className="hollow-fx"><HollowRoom plan={hollowRuntimePlan(HOLLOW_EFFECT_DEFAULTS, false)} /></div>);
    expect(document.querySelector(".hollow-passing-shadow, .hollow-spectral-trail")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses four pooled trails on card exit, never reads pointer geometry, and cancels on hide", () => {
    const view = render(<><div className="card"><span>Copy</span></div><HollowRoom plan={hollowRuntimePlan(HOLLOW_EFFECT_DEFAULTS, true)} /></>);
    const geometry = vi.spyOn(Element.prototype, "getBoundingClientRect");
    const copy = view.container.querySelector("span")!;
    for (let i = 0; i < 6; i++) act(() => {
      copy.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body, clientX: 800, clientY: 500 }));
    });
    expect(document.querySelectorAll(".hollow-spectral-trail")).toHaveLength(4);
    expect(Element.prototype.animate).toHaveBeenCalledTimes(6);
    expect(geometry).not.toHaveBeenCalled();
    expect(vi.mocked(Element.prototype.animate).mock.calls[0][1]).toMatchObject({ duration: 600 });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(cancel).toHaveBeenCalledTimes(6);
    view.unmount();
  });
});
