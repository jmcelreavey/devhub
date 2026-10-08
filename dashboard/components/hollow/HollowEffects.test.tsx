/** @vitest-environment jsdom */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLLOW_EFFECT_DEFAULTS, hollowRuntimePlan } from "@/lib/hollow-theme";
import { HollowEffects } from "./HollowEffects";
import { occupiedRects } from "./hollow-placement";

vi.mock("./hollow-placement", async (importOriginal) => ({
  ...await importOriginal<typeof import("./hollow-placement")>(),
  quietHollowSlots: () => [{ x: 700, y: 700 }],
  quietSpiderColumn: () => 900,
  occupiedRects: vi.fn(() => []),
}));

describe("Hollow runtime lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 42);
    vi.spyOn(window, "cancelAnimationFrame");
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });
  afterEach(() => {
    cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
    vi.mocked(occupiedRects).mockReturnValue([]);
    window.history.replaceState(null, "", "/");
    delete document.documentElement.dataset.theme;
  });

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
    expect(document.querySelector(".hollow-pair, .hollow-spider, .hollow-face, .hollow-passing-shadow")).toBeNull();
    expect(document.querySelector(".hollow-atmosphere")).not.toBeNull();
    view.unmount();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("keeps stronger fog in the empty-space mask and gates rare events", () => {
    const view = render(<HollowEffects plan={hollowRuntimePlan(HOLLOW_EFFECT_DEFAULTS, true)} preview={true} faceShot={false} />);
    expect(document.querySelector(".hollow-room .hollow-passing-shadow")).not.toBeNull();
    expect(document.querySelector(".hollow-room .hollow-fog-mid")).not.toBeNull();
    view.rerender(<HollowEffects plan={hollowRuntimePlan({ ...HOLLOW_EFFECT_DEFAULTS, creatures: false }, true)} preview={true} faceShot={false} />);
    expect(document.querySelector(".hollow-passing-shadow")).toBeNull();
    view.rerender(<HollowEffects plan={hollowRuntimePlan({ ...HOLLOW_EFFECT_DEFAULTS, rareEvents: false }, true)} preview={true} faceShot={false} />);
    expect(document.querySelector(".hollow-passing-shadow, .hollow-rare-dim")).toBeNull();
    view.rerender(<HollowEffects plan={hollowRuntimePlan({ ...HOLLOW_EFFECT_DEFAULTS, atmosphere: false }, true)} preview={true} faceShot={false} />);
    expect(document.querySelector(".hollow-atmosphere, .hollow-fog-mid, .hollow-passing-shadow")).toBeNull();
  });

  it("subtracts occupied content from the strong exposure and hides it while geometry is stale", () => {
    vi.mocked(occupiedRects).mockReturnValue([{ left: 300, top: 250, right: 850, bottom: 700 }]);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.id === "main-content" ? new DOMRect(240, 80, 1200, 820) : new DOMRect();
    });
    render(<><main id="main-content" /><HollowEffects plan={hollowRuntimePlan(HOLLOW_EFFECT_DEFAULTS, true)} preview={false} faceShot={false} /></>);
    const scenery = document.querySelector(".hollow-scenery") as HTMLElement;
    const mask = decodeURIComponent(scenery.style.maskImage);
    expect(mask).toContain('x="298" y="248" width="554" height="454" fill="black"');
    const mist = document.querySelector(".hollow-room-mist") as HTMLElement;
    expect(mist.style.webkitMaskImage).toBe(mist.style.maskImage);
    expect(decodeURIComponent(mist.style.maskImage)).toContain('id="murk"');
    for (const selector of [".hollow-room-backlight", ".hollow-fog-far", ".hollow-fog-near", ".hollow-fog-mid", ".hollow-passing-shadow"]) {
      expect(document.querySelector(selector)?.parentElement).toBe(mist);
    }
    expect(document.querySelector(".hollow-cobweb")?.parentElement).not.toBe(mist);
    expect(scenery.style.visibility).toBe("visible");
    act(() => { document.dispatchEvent(new Event("scroll")); });
    expect(scenery.style.visibility).toBe("hidden");
    act(() => { vi.advanceTimersByTime(81); });
    expect(scenery.style.visibility).toBe("visible");
    vi.mocked(occupiedRects).mockReturnValue([]);
  });

  it.each(["dark", "light"])("protects non-card text from every exposure at the rare-event peak in %s", async (mode) => {
    document.documentElement.dataset.theme = mode;
    window.history.replaceState(null, "", "/?hollowRare=1");
    const actual = await vi.importActual<typeof import("./hollow-placement")>("./hollow-placement");
    vi.mocked(occupiedRects).mockImplementation(actual.occupiedRects);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const values = this.dataset.rect?.split(",").map(Number);
      return values ? new DOMRect(...values) : new DOMRect();
    });
    const createRange = document.createRange.bind(document);
    vi.spyOn(document, "createRange").mockImplementation(() => {
      const range = createRange();
      range.getClientRects = () => {
        const el = range.startContainer.parentElement?.closest<HTMLElement>("[data-rect]");
        const ink = el?.dataset.ink?.split(",").map(Number);
        return [ink ? new DOMRect(...ink) : el?.getBoundingClientRect() ?? new DOMRect()] as unknown as DOMRectList;
      };
      return range;
    });
    render(<>
      <div role="tablist"><button role="tab" data-rect="250,52,90,24">Today</button></div>
      <main id="main-content" data-rect="240,80,1200,820">
        <div className="hub-hero-greeting" data-rect="260,155,110,20">Good evening</div>
        <h1 className="hub-hero-date" data-rect="260,180,1100,48" data-ink="260,180,440,48">Thursday, October 8</h1>
        <div className="hub-hero-sub" data-rect="260,236,340,24">08:13 PM · 1/4 tasks done</div>
        <div className="hub-card" data-rect="260,300,700,400"><p>Card content</p></div>
      </main>
      <HollowEffects plan={hollowRuntimePlan(HOLLOW_EFFECT_DEFAULTS, true)} preview={false} faceShot={false} />
    </>);
    const scenery = document.querySelector(".hollow-scenery") as HTMLElement;
    expect(scenery.style.visibility).toBe("visible");
    expect(document.querySelector(".hollow-fx")?.classList.contains("is-rare-preview")).toBe(true);
    for (const selector of [".hollow-rare-dim", ".hollow-vignette", ".hollow-keylight", ".hollow-room-backlight", ".hollow-fog"]) {
      expect(document.querySelector(selector)?.closest(".hollow-scenery")).toBe(scenery);
    }
    expect(scenery.style.webkitMaskImage).toBe(scenery.style.maskImage);
    const svg = decodeURIComponent(scenery.style.maskImage).match(/<svg[\s\S]*<\/svg>/)![0];
    const mask = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(mask.querySelector("svg > rect")?.getAttribute("mask")).toBe("url(#readable)");
    const cores = [...mask.querySelectorAll("#readable > rect[fill='black']")];
    // Check the full box, not just a glyph centre or the opacity ceiling.
    for (const el of document.querySelectorAll<HTMLElement>("[data-rect]:not(main)")) {
      const ink = el.dataset.ink?.split(",").map(Number);
      const r = ink ? new DOMRect(...ink) : el.getBoundingClientRect();
      for (const [x, y] of [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]]) {
        expect(cores.some(core => x >= Number(core.getAttribute("x")) && y >= Number(core.getAttribute("y"))
          && x <= Number(core.getAttribute("x")) + Number(core.getAttribute("width"))
          && y <= Number(core.getAttribute("y")) + Number(core.getAttribute("height"))), el.textContent ?? "").toBe(true);
      }
    }
    // The date is a block heading, but its empty right-hand space must keep
    // the backlight instead of becoming a full-width dark band.
    expect(cores.some(core => core.getAttribute("width") === "1104")).toBe(false);
    const progress = document.querySelector(".hub-hero-sub")!;
    await act(async () => {
      progress.setAttribute("data-rect", "260,236,360,24");
      progress.firstChild!.textContent = "08:14 PM · 2/4 tasks done";
    });
    expect(decodeURIComponent(scenery.style.maskImage)).toContain('x="258" y="234" width="364" height="28" fill="black"');
    expect(scenery.style.visibility).toBe("visible");
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
