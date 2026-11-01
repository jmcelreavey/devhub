import { describe, expect, it } from "vitest";
import { desktopNavigationInput, uiOpenInput } from "./ui.ts";

// Agent hrefs must never acquire the browser channel's broader navigation authority.
describe("navigation contracts", () => {
  it("rejects external links and API pages for agents while retaining browser paths", () => {
    for (const href of ["https://example.test", "//example.test", "", " "]) {
      expect(uiOpenInput.safeParse({ href }).success).toBe(false);
      expect(desktopNavigationInput.safeParse({ href, newTab: true }).success).toBe(false);
    }
    expect(uiOpenInput.safeParse({ href: "/api/status/exec" }).success).toBe(false);
    expect(desktopNavigationInput.parse({ href: " /api/status/exec ", newTab: true }).href).toBe("/api/status/exec");
    expect(uiOpenInput.parse({ href: " /work " }).href).toBe("/work");
    expect(desktopNavigationInput.safeParse({ href: "/work", newTab: false }).success).toBe(false);
  });
});
