/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { applyLogoChoice, getLogoBootstrapInlineScript, HAS_PLUGIN_BRAND } from "./brand-mark";

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-logo");
});

function runBootstrap() {
  // Production path is an inline <script>; Function() is the test equivalent.
  new Function(getLogoBootstrapInlineScript())();
}

describe("getLogoBootstrapInlineScript", () => {
  it("defaults to the DevHub bottle when nothing is stored", () => {
    runBootstrap();
    expect(document.documentElement.getAttribute("data-logo")).toBe("devhub");
  });

  it("keeps the DevHub bottle when the user picked the DevHub logo", () => {
    localStorage.setItem("devhub-logo-icon", "__devhub__");
    runBootstrap();
    expect(document.documentElement.getAttribute("data-logo")).toBe("devhub");
  });

  it("uses the plugin mark only for the explicit plugin-brand sentinel", () => {
    localStorage.setItem("devhub-logo-icon", "__bottle__");
    runBootstrap();
    expect(document.documentElement.getAttribute("data-logo")).toBe(
      HAS_PLUGIN_BRAND ? "plugin" : "devhub",
    );
  });

  it("ignores lucide/seasonal picks for the boot mark", () => {
    localStorage.setItem("devhub-logo-icon", "Rocket");
    runBootstrap();
    expect(document.documentElement.getAttribute("data-logo")).toBe("devhub");
  });
});

describe("applyLogoChoice", () => {
  it("sets plugin only for the plugin-brand sentinel", () => {
    applyLogoChoice("__bottle__");
    expect(document.documentElement.getAttribute("data-logo")).toBe(
      HAS_PLUGIN_BRAND ? "plugin" : "devhub",
    );
    applyLogoChoice("__devhub__");
    expect(document.documentElement.getAttribute("data-logo")).toBe("devhub");
    applyLogoChoice(null);
    expect(document.documentElement.getAttribute("data-logo")).toBe("devhub");
  });
});
