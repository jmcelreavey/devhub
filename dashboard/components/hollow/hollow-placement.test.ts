/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { hollowSlotFits, quietHollowSlots, quietSpiderColumn } from "./hollow-placement";

const box = { left: 100, right: 204, top: 100, bottom: 152 };
const gutter = document.createElement("main");
const originalHitTest = Object.getOwnPropertyDescriptor(document, "elementsFromPoint");

describe("Hollow creature placement", () => {
  afterEach(() => {
    document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
    if (originalHitTest) Object.defineProperty(document, "elementsFromPoint", originalHitTest);
    else Reflect.deleteProperty(document, "elementsFromPoint");
  });

  it("accepts an empty gutter and samples every corner plus the centre", () => {
    const points: number[][] = [];
    expect(hollowSlotFits(box, [], (x, y) => { points.push([x, y]); return gutter; })).toBe(true);
    expect(points).toEqual([[100, 100], [204, 100], [100, 152], [204, 152], [152, 126]]);
  });

  it.each(["a", "button", "input", "p"])("rejects a %s at even one corner", (tag) => {
    const control = document.createElement(tag);
    expect(hollowSlotFits(box, [], (x, y) => x === 204 && y === 100 ? control : gutter)).toBe(false);
  });

  it("rejects text in an unclassified span", () => {
    const span = document.createElement("span");
    span.textContent = "View all";
    expect(hollowSlotFits(box, [], () => span)).toBe(false);
  });

  it("rejects a card descendant and a small control between sample points", () => {
    const card = document.createElement("div");
    card.className = "hub-card";
    const child = card.appendChild(document.createElement("span"));
    expect(hollowSlotFits(box, [], () => child)).toBe(false);
    expect(hollowSlotFits(box, [{ left: 173, right: 193, top: 109, bottom: 123 }], () => gutter)).toBe(false);
  });

  it("rejects a control along the spider's descent, not just its endpoint", () => {
    expect(hollowSlotFits(
      { left: 100, right: 156, top: 112, bottom: 248 },
      [{ left: 120, right: 142, top: 171, bottom: 185 }],
      () => gutter,
    )).toBe(false);
  });

  function obstacle(left: number, top: number) {
    vi.stubGlobal("innerWidth", 1440);
    vi.stubGlobal("innerHeight", 900);
    const button = document.body.appendChild(document.createElement("button"));
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue(new DOMRect(left, top, 8, 8));
    Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [gutter] });
  }

  it("rejects a control inside the enlarged eye halo, outside the old socket bounds", () => {
    const first = { x: 1440 * 0.91, y: 900 * 0.88 };
    obstacle(first.x + 68, first.y);
    expect(quietHollowSlots(1, true)).not.toContainEqual(first);
    expect(quietHollowSlots(1, true)).toHaveLength(1);
  });

  it("rejects a control under the enlarged spider legs and tries the next column", () => {
    obstacle(1440 * 0.94 + 45, 180);
    expect(quietSpiderColumn()).toBe(1440 * 0.85);
  });

  it("keeps the thread clear of controls above the spider body", () => {
    obstacle(1440 * 0.94, 90);
    expect(quietSpiderColumn()).toBe(1440 * 0.85);
  });
});
