import { describe, expect, it, vi } from "vitest";
import { startMacGitInstall } from "./git-install";

describe("startMacGitInstall", () => {
  it("does not run on linux", async () => {
    const run = vi.fn(async () => undefined);
    const result = await startMacGitInstall({ platform: "linux", method: "POST", run });
    expect(result.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it("does not run unless the method is POST", async () => {
    const run = vi.fn(async () => undefined);
    const result = await startMacGitInstall({ platform: "darwin", method: "GET", run });
    expect(result.status).toBe(405);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs xcode-select --install on darwin POST and nothing else", async () => {
    const run = vi.fn(async () => undefined);
    const result = await startMacGitInstall({ platform: "darwin", method: "POST", run });
    expect(result.status).toBe(200);
    expect(result.body.message).toMatch(/24 GB/);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("xcode-select", ["--install"]);
  });
});
