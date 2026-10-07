import { describe, expect, it } from "vitest";
import { setupCoreDefaults } from "./core-defaults";

describe("setupCoreDefaults", () => {
  it("never suggests paths inside the installed app's versioned payload", () => {
    const defaults = setupCoreDefaults({
      desktop: true,
      checkoutRoot: null,
      cwd: "/home/me/.local/share/devhub/runtime/b2f4fb73b1f330b3/server",
      appDataDir: "/home/me/.local/share/devhub",
    });
    expect(defaults).toEqual({ repoRoot: "", notesDir: "/home/me/.local/share/devhub/notes" });
  });

  it("uses a linked checkout in the desktop app", () => {
    const defaults = setupCoreDefaults({
      desktop: true,
      checkoutRoot: "/home/me/dev/devhub-private",
      cwd: "/home/me/.local/share/devhub/runtime/abc/server",
      appDataDir: "/home/me/.local/share/devhub",
    });
    expect(defaults).toEqual({ repoRoot: "/home/me/dev", notesDir: "/home/me/dev/devhub-private/notes" });
  });

  it("keeps the checkout behaviour unchanged", () => {
    expect(
      setupCoreDefaults({ desktop: false, checkoutRoot: null, cwd: "/src/devhub/dashboard", appDataDir: "/src/devhub" }),
    ).toEqual({ repoRoot: "/src", notesDir: "/src/devhub/notes" });
    expect(
      setupCoreDefaults({
        desktop: false,
        checkoutRoot: "/src/devhub",
        configuredRepoRoot: "/work/devhub",
        cwd: "/src/devhub/dashboard",
        appDataDir: "/src/devhub",
      }),
    ).toEqual({ repoRoot: "/work", notesDir: "/work/devhub/notes" });
  });
});
