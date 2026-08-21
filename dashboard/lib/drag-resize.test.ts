import { describe, expect, it } from "vitest";
import { clampSize } from "./drag-resize";

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
