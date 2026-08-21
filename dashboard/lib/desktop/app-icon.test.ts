import { describe, expect, it } from "vitest";
import { desktopIconKind } from "./app-icon";

describe("desktopIconKind", () => {
  it("resets to the bundled DevHub icon when the user picks the DevHub logo", () => {
    expect(desktopIconKind("__devhub__", true)).toBe("default");
    expect(desktopIconKind("__devhub__", false)).toBe("default");
  });

  it("uses the plugin icon for the active brand logo when a plugin brand exists", () => {
    expect(desktopIconKind("__bottle__", true)).toBe("plugin");
    expect(desktopIconKind("__bottle__", false)).toBe("default");
  });

  it("treats a missing preference as the active brand", () => {
    expect(desktopIconKind("", true)).toBe("plugin");
    expect(desktopIconKind("", false)).toBe("default");
  });

  it("leaves Lucide and seasonal picks alone", () => {
    expect(desktopIconKind("Rocket", true)).toBeNull();
    expect(desktopIconKind("__seasonal__", true)).toBeNull();
  });
});
