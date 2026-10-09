import { describe, expect, it, vi } from "vitest";
import { diagnosticToolFlags, flagsFromExits } from "./tool-flags";

vi.mock("@/lib/setup/git-availability", () => ({
  assessGitAvailabilitySync: vi.fn(() => ({ runnable: false, bin: "/usr/bin/git", cltShim: true })),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execFileSync: (file: string) => {
      if (file === "gh" || String(file).endsWith("/gh")) {
        const error = new Error("gh missing");
        throw Object.assign(error, { status: 127 });
      }
      throw new Error(`git must not run (${file})`);
    },
  };
});

describe("plugin tool flags", () => {
  it("uses --version exit codes and the runtime app version", () => {
    expect(flagsFromExits({ gitExit: 0, ghExit: 1, appVersion: "2.0.3" })).toEqual({
      gitAvailable: true,
      ghAvailable: false,
      appVersion: "2.0.3",
    });
    expect(flagsFromExits({ gitExit: null, ghExit: null, appVersion: "  " }).appVersion).toBe("unknown");
  });

  it("does not run git when the shim check says it is missing", () => {
    const flags = diagnosticToolFlags({ NODE_ENV: "test", DEVHUB_VERSION: "2.0.3", PATH: "/usr/bin" });
    expect(flags).toEqual({ gitAvailable: false, ghAvailable: false, appVersion: "2.0.3" });
    expect(flags.appVersion).not.toContain("/Users/runner");
  });
});
