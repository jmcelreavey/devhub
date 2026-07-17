import { describe, expect, it } from "vitest";
import { revealPathLabel } from "./reveal-path";

describe("revealPathLabel", () => {
  it("returns Finder on macOS", () => {
    expect(revealPathLabel("darwin")).toBe("Finder");
  });

  it("returns Explorer on Windows", () => {
    expect(revealPathLabel("win32")).toBe("Explorer");
  });

  it("returns Show folder on Linux", () => {
    expect(revealPathLabel("linux")).toBe("Show folder");
  });
});
