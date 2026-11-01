import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assessGitAvailability } from "../setup/git-availability";
import { diagnosticToolFlags, flagsFromExits } from "./tool-flags";

vi.mock("../setup/git-availability", () => ({
  assessGitAvailability: vi.fn(async () => ({ runnable: false, bin: "/usr/bin/git", cltShim: true })),
}));

const roots: string[] = [];

function scratch(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-tool-flags-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
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

  it("does not run git when the shim check says it is missing", async () => {
    const flags = await diagnosticToolFlags({ NODE_ENV: "test", DEVHUB_VERSION: "2.0.3", PATH: scratch() });
    expect(flags).toEqual({ gitAvailable: false, ghAvailable: false, appVersion: "2.0.3" });
    expect(flags.appVersion).not.toContain("/Users/runner");
  });

  it.skipIf(process.platform === "win32")("runs the discovered Git even when it is outside the supplied PATH", async () => {
    const root = scratch();
    const git = path.join(root, "git");
    fs.writeFileSync(git, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const available = { runnable: true, bin: git, cltShim: false };
    vi.mocked(assessGitAvailability).mockResolvedValueOnce(available).mockResolvedValueOnce(available);
    const flags = await diagnosticToolFlags({ NODE_ENV: "test", DEVHUB_VERSION: "2.0.3", PATH: "" });
    expect(flags).toMatchObject({ gitAvailable: true, ghAvailable: false });
  });

  it.skipIf(process.platform === "win32")("keeps the event loop responsive while a tool probe runs", async () => {
    const root = scratch();
    fs.writeFileSync(path.join(root, "gh"), "#!/bin/sh\n/bin/sleep 1\n", { mode: 0o755 });
    let timerFired = false;
    const timer = setTimeout(() => { timerFired = true; }, 50);
    try {
      const flags = await diagnosticToolFlags({ NODE_ENV: "test", DEVHUB_VERSION: "2.0.3", PATH: root });
      expect(timerFired).toBe(true);
      expect(flags.ghAvailable).toBe(true);
    } finally {
      clearTimeout(timer);
    }
  });
});
