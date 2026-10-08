/** @vitest-environment jsdom */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLLOW_EFFECT_DEFAULTS, hollowRuntimePlan } from "@/lib/hollow-theme";
import { HollowEffects } from "./HollowEffects";

vi.mock("./hollow-placement", async (importOriginal) => ({
  ...await importOriginal<typeof import("./hollow-placement")>(),
  quietHollowSlots: () => [{ x: 700, y: 700 }],
  quietSpiderColumn: () => 900,
}));

describe("Hollow runtime lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 42);
    vi.spyOn(window, "cancelAnimationFrame");
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("schedules no idle frames, coalesces pointer moves, and cancels on hide/unmount", () => {
    const view = render(<HollowEffects plan={hollowRuntimePlan(HOLLOW_EFFECT_DEFAULTS, true)} preview={false} faceShot={false} />);
    act(() => { vi.advanceTimersByTime(34000); });
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 450, clientY: 450 }));
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 460, clientY: 450 }));
    });
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    act(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
    view.unmount();
    vi.mocked(requestAnimationFrame).mockClear();
    window.dispatchEvent(new MouseEvent("pointermove"));
    act(() => { vi.advanceTimersByTime(60000); });
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(document.querySelector(".hollow-fx")).toBeNull();
    expect(document.documentElement.hasAttribute("data-hollow-paused")).toBe(false);
  });

  it("preview cannot bypass reduced motion or enable a default-off apparition", () => {
    const view = render(<HollowEffects plan={hollowRuntimePlan(HOLLOW_EFFECT_DEFAULTS, false)} preview={true} faceShot={true} />);
    expect(document.querySelector(".hollow-pair, .hollow-spider, .hollow-face")).toBeNull();
    expect(document.querySelector(".hollow-atmosphere")).not.toBeNull();
    view.unmount();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("keeps the pointer tint off text, controls, and card content", () => {
    render(<><span data-testid="copy">Readable copy</span><button>Open</button><div className="hub-card"><div data-testid="card-space" /></div>
      <HollowEffects plan={hollowRuntimePlan(HOLLOW_EFFECT_DEFAULTS, true)} preview={false} faceShot={false} /></>);
    for (const target of document.querySelectorAll("[data-testid='copy'], button, [data-testid='card-space']")) {
      act(() => {
        target.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 100, clientY: 100 }));
        vi.mocked(requestAnimationFrame).mock.calls.at(-1)?.[0](0);
      });
      expect((document.querySelector(".hollow-cursor-trail") as HTMLElement).style.opacity).toBe("0");
    }
  });
});
