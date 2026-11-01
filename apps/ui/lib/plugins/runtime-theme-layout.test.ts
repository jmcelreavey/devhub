/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addSceneRect, measureRuntimeScene, observeRuntimeScene, roundedSceneRect, type RuntimeSceneGeometry, type RuntimeSceneRect } from "./runtime-theme-layout";

function bounds(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) } as DOMRect;
}

beforeEach(() => {
  document.body.innerHTML = '<main id="main-content" data-bounds="0,0,1200,900"><div class="card" data-bounds="19,75,160,60">public heading</div><div class="cm-editor" data-bounds="300,100,240,160"><span data-bounds="310,110,80,20">private editor text</span></div><input data-bounds="700,100,120,40" value="private input value"></main>';
  Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
  Object.defineProperty(document, "elementsFromPoint", { value: () => [document.body], configurable: true });
  Object.defineProperty(Range.prototype, "getClientRects", { value: () => [], configurable: true });
  vi.stubGlobal("CSS", { supports: () => true });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const raw = this.getAttribute("data-bounds");
    return raw ? bounds(...raw.split(",").map(Number) as [number, number, number, number]) : bounds(0, 0, 0, 0);
  });
});

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

describe("runtime scene privacy boundary", () => {
  it("rounds outwards, clamps and merges without truncating protection", () => {
    expect(roundedSceneRect(bounds(-2, 11, 35, 22), 30, 30)).toEqual([0, 8, 30, 30]);
    const rects: RuntimeSceneRect[] = [];
    expect(addSceneRect(rects, [0, 0, 8, 8])).toBe(true);
    expect(addSceneRect(rects, [8, 0, 16, 8])).toBe(true);
    expect(rects).toEqual([[0, 0, 16, 8]]);
    for (let index = 1; index < 512; index++) expect(addSceneRect(rects, [index * 24, 0, index * 24 + 8, 8])).toBe(true);
    expect(addSceneRect(rects, [20000, 0, 20008, 8])).toBe(false);
    expect(rects).toHaveLength(513);
  });

  it("keeps editor and input geometry and all text out of the surface payload", () => {
    const geometry = measureRuntimeScene();
    expect(geometry).not.toBeNull();
    expect(geometry!.layout.room).toEqual([0, 0, 1200, 900]);
    expect(geometry!.layout.occupied).toEqual([[16, 72, 184, 136]]);
    const payload = JSON.stringify(geometry!.layout);
    expect(payload).not.toContain("private");
    expect(payload).not.toContain("300");
    expect(payload).not.toContain("700");
    const hostMask = decodeURIComponent(geometry!.sceneMask);
    expect(hostMask).toContain('x="294"');
    expect(hostMask).toContain('x="694"');
  });

  it("fails closed when masking is unavailable, geometry is invalid or node limits are exceeded", () => {
    vi.stubGlobal("CSS", { supports: () => false });
    expect(measureRuntimeScene()).toBeNull();
    vi.stubGlobal("CSS", { supports: () => true });
    document.querySelector("input")!.setAttribute("data-bounds", "NaN,0,10,10");
    expect(measureRuntimeScene()).toBeNull();
    document.querySelector("input")!.remove();
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 4097; index++) fragment.append(document.createElement("span"));
    document.body.append(fragment);
    expect(measureRuntimeScene()).toBeNull();
  });

  it("fails closed when the complete merged geometry exceeds the byte limit", () => {
    Object.defineProperty(window, "innerWidth", { value: 30000000, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 30000000, configurable: true });
    document.body.innerHTML = '<main id="main-content" data-bounds="0,0,30000000,30000000"></main>';
    const main = document.getElementById("main-content")!;
    for (let index = 0; index < 250; index++) {
      const card = document.createElement("div"), input = document.createElement("input");
      card.className = "card";
      card.setAttribute("data-bounds", `${1000000 + index * 32},1000000,8,8`);
      input.setAttribute("data-bounds", `${1000000 + index * 32},1000100,8,8`);
      main.append(card, input);
    }
    expect(measureRuntimeScene()).toBeNull();
  });

  it("hides stale geometry immediately, coalesces remeasurement and disconnects", () => {
    vi.useFakeTimers();
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect = disconnect; });
    const updates: (RuntimeSceneGeometry | null)[] = [];
    const stop = observeRuntimeScene(value => updates.push(value));
    vi.advanceTimersByTime(80);
    expect(updates.at(-1)?.layout).toBeDefined();
    window.dispatchEvent(new Event("scroll"));
    expect(updates.at(-1)).toBeNull();
    vi.advanceTimersByTime(199);
    expect(updates.at(-1)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(updates.at(-1)?.layout).toBeDefined();
    stop();
    expect(updates.at(-1)).toBeNull();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
