import { describe, expect, it } from "vitest";
import { clampSize, resizeRect, type ResizeAxis } from "./drag-resize";

describe("resizeRect", () => {
  const start = { x: 200, y: 150, w: 400, h: 300 };
  const bounds = { x: 16, y: 52, w: 968, h: 732 };
  const minimum = { w: 360, h: 280 };

  it.each<[ResizeAxis, { x: number; y: number; w: number; h: number }]>([
    ["n", { x: 200, y: 160, w: 400, h: 290 }],
    ["e", { x: 200, y: 150, w: 420, h: 300 }],
    ["s", { x: 200, y: 150, w: 400, h: 310 }],
    ["w", { x: 220, y: 150, w: 380, h: 300 }],
    ["ne", { x: 200, y: 160, w: 420, h: 290 }],
    ["se", { x: 200, y: 150, w: 420, h: 310 }],
    ["sw", { x: 220, y: 150, w: 380, h: 310 }],
    ["nw", { x: 220, y: 160, w: 380, h: 290 }],
  ])("resizes %s without moving the opposite edges", (axis, expected) => {
    expect(resizeRect(start, axis, { x: 20, y: 10 }, bounds, minimum)).toEqual(expected);
    expect(resizeRect(expected, axis, { x: -20, y: -10 }, bounds, minimum)).toEqual(start);
  });

  it("clamps north/west shrinkage without shifting the opposite corner", () => {
    expect(resizeRect(start, "nw", { x: 999, y: 999 }, bounds, minimum))
      .toEqual({ x: 240, y: 170, w: 360, h: 280 });
  });

  it("stops growth at viewport boundaries", () => {
    expect(resizeRect(start, "nw", { x: -999, y: -999 }, bounds, minimum))
      .toEqual({ x: 16, y: 52, w: 584, h: 398 });
    expect(resizeRect(start, "se", { x: 999, y: 999 }, bounds, minimum))
      .toEqual({ x: 200, y: 150, w: 784, h: 634 });
  });

  it("keeps the far edge fixed after a floating window has moved", () => {
    const moved = { ...start, x: 350, y: 250 };
    const resized = resizeRect(moved, "nw", { x: -50, y: -40 }, bounds, minimum);
    expect(resized).toEqual({ x: 300, y: 210, w: 450, h: 340 });
    expect(resized.x + resized.w).toBe(moved.x + moved.w);
    expect(resized.y + resized.h).toBe(moved.y + moved.h);
  });

  it("honours CSS size limits when growing from a partially off-screen position", () => {
    const moved = { ...start, x: -100, y: 0 };
    const viewport = { x: 0, y: 0, w: 1000, h: 800 };
    expect(resizeRect(moved, "se", { x: 2000, y: 2000 }, viewport, minimum, { w: 968, h: 732 }))
      .toEqual({ x: -100, y: 0, w: 968, h: 732 });
    expect(resizeRect(moved, "nw", { x: 0, y: 0 }, viewport, minimum)).toEqual(moved);
  });

  it("does not jump when the pointer has not moved", () => {
    expect(resizeRect(start, "nw", { x: 0, y: 0 }, bounds, minimum)).toEqual(start);
  });
});

describe("clampSize", () => {
  it("keeps a value inside the range", () => {
    expect(clampSize(400, 200, 800)).toBe(400);
  });

  it("raises a value below the minimum", () => {
    expect(clampSize(10, 200, 800)).toBe(200);
  });

  it("caps a value above the maximum", () => {
    expect(clampSize(9_999, 200, 800)).toBe(800);
  });

  it("prefers the minimum when the range inverts on a tiny viewport", () => {
    expect(clampSize(500, 300, 100)).toBe(300);
  });

  it("rounds to whole pixels", () => {
    expect(clampSize(300.6, 100, 800)).toBe(301);
  });
});
