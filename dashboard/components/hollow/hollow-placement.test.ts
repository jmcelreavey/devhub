/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { hollowContentMask, hollowSlotFits, quietHollowSlots, quietSpiderColumn } from "./hollow-placement";

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

describe("Hollow mist envelope", () => {
  it.each([750, 780, 1440, 1920])("reaches zero before every room edge at %i px, including DPR 2", async (width) => {
    const height = 900;
    const room = { left: width < 768 ? 0 : 232, top: 80, right: width, bottom: height };
    const card = { left: room.left + 28, top: 300, right: width - 28, bottom: 520 };
    const { data, info } = await sharp(Buffer.from(hollowContentMask([card], width, height, room)), { density: 144 })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let edgePeak = 0, cardPeak = 0, emptyPeak = 0;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const alpha = data[(y * info.width + x) * info.channels + 3];
      const px = x / 2, py = y / 2;
      if (px < room.left + 12 || px >= room.right - 12 || py < room.top + 12 || py >= room.bottom - 12) edgePeak = Math.max(edgePeak, alpha);
      if (px >= card.left && px < card.right && py >= card.top && py < card.bottom) cardPeak = Math.max(cardPeak, alpha);
      if (py > card.bottom + 80) emptyPeak = Math.max(emptyPeak, alpha);
    }
    expect(edgePeak, "zero alpha before the viewport/sidebar bounds").toBe(0);
    expect(cardPeak, "keep readable surfaces fully excluded").toBe(0);
    expect(emptyPeak, "keep visible murk in empty space").toBeGreaterThan(40);
  });

  it("fades broadly away from a card without a sharp alpha step", async () => {
    const { data, info } = await sharp(Buffer.from(hollowContentMask(
      [{ left: 480, top: 360, right: 640, bottom: 540 }], 1440, 900,
      { left: 232, top: 80, right: 1440, bottom: 900 },
    ))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = (x: number) => data[(450 * info.width + x) * info.channels + 3];
    expect(alpha(648)).toBe(0);
    expect(alpha(680)).toBeLessThan(40);
    expect(alpha(740)).toBeGreaterThan(100);
    for (let x = 642; x < 740; x++) expect(Math.abs(alpha(x + 1) - alpha(x))).toBeLessThanOrEqual(8);
  });

  it("keeps the density plate transparent along all four edges", async () => {
    const { data, info } = await sharp("public/hollow/fog-density.webp").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
    for (let x = 0; x < info.width; x++) {
      expect(alpha(x, 0)).toBe(0);
      expect(alpha(x, info.height - 1)).toBe(0);
    }
    for (let y = 0; y < info.height; y++) {
      expect(alpha(0, y)).toBe(0);
      expect(alpha(info.width - 1, y)).toBe(0);
    }
  });
});
