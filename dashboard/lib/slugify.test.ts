import { describe, expect, it } from "vitest";
import { slugify } from "./slugify";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("respects maxLen and fallback", () => {
    expect(slugify("!!!", { maxLen: 60, fallback: "meeting" })).toBe("meeting");
    expect(slugify("a".repeat(80), { maxLen: 10 })).toHaveLength(10);
  });
});
