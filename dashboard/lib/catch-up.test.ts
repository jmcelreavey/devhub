import { describe, expect, it } from "vitest";
import { catchUpSince, isCaughtUp } from "./catch-up";

describe("catch-up semantics", () => {
  it("uses the saved watermark unless recent history was requested", () => {
    expect(catchUpSince("watermark", "abc")).toBe("abc");
    expect(catchUpSince("recent", "abc")).toBeNull();
  });

  it("re-surfaces magnitude-based items only after they grow", () => {
    expect(isCaughtUp(3, 3)).toBe(true);
    expect(isCaughtUp(2, 3)).toBe(true);
    expect(isCaughtUp(4, 3)).toBe(false);
  });
});
