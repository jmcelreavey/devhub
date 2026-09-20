import { describe, expect, it } from "vitest";
import { isNewerVersion } from "./update";

describe("isNewerVersion", () => {
  it.each([["2.2.3", "2.2.2", true], ["2.3.0", "2.2.9", true], ["3.0.0", "2.9.9", true], ["2.2.2", "2.2.2", false], ["2.1.9", "2.2.0", false]])("compares %s with %s", (latest, current, expected) => {
    expect(isNewerVersion(latest, current)).toBe(expected);
  });
});
