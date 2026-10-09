import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls: string[][] = [];

vi.mock("@/lib/exec-external", () => ({
  execExternal: vi.fn(async (file: string, args: string[]) => {
    calls.push([file, ...args]);
    if (path.basename(file) === "git") throw new Error("git must not run");
    const error = new Error("xcode-select: error: unable to get active developer directory");
    throw Object.assign(error, { code: 1 });
  }),
}));

import { execExternal } from "@/lib/exec-external";
import {
  assessGitAvailability,
  assessGitAvailabilitySync,
  clearGitAvailabilityCache,
} from "./git-availability";

const shimOnly = {
  env: { NODE_ENV: "test" as const, PATH: "/usr/bin" },
  platform: "darwin" as const,
  augment: false,
  fresh: true,
  exists: (file: string) => file === "/usr/bin/git",
  dirExists: () => false,
  executable: (file: string) => file === "/usr/bin/git",
  realpath: (file: string) => file,
};

afterEach(() => {
  calls.length = 0;
  vi.mocked(execExternal).mockClear();
  clearGitAvailabilityCache();
  vi.restoreAllMocks();
});

describe("assessGitAvailability", () => {
  it("does not run git when xcode-select fails", async () => {
    vi.spyOn(fs, "statSync").mockImplementation((file) => {
      if (String(file) === "/usr/bin/git") return { isFile: () => true, isDirectory: () => false } as fs.Stats;
      const error = new Error("ENOENT");
      throw Object.assign(error, { code: "ENOENT" });
    });
    vi.spyOn(fs, "accessSync").mockImplementation((file) => {
      if (String(file) !== "/usr/bin/git") {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
    });
    vi.spyOn(fs, "realpathSync").mockImplementation((file) => String(file));

    const result = await assessGitAvailability({
      env: { NODE_ENV: "test" as const, PATH: "/usr/bin" },
      platform: "darwin",
      augment: false,
      fresh: true,
    });

    expect(result).toEqual({ runnable: false, bin: "/usr/bin/git", cltShim: true });
    expect(calls).toEqual([["xcode-select", "-p"]]);
    expect(calls.some((call) => call[0] === "git" || call[0]?.endsWith("/git"))).toBe(false);
  });

  it("treats a Homebrew git as available without calling xcode-select or git", async () => {
    const result = await assessGitAvailability({
      ...shimOnly,
      env: { NODE_ENV: "test" as const, PATH: "/usr/bin:/opt/homebrew/bin" },
      exists: (file: string) => file === "/usr/bin/git" || file === "/opt/homebrew/bin/git",
      executable: (file: string) => file === "/usr/bin/git" || file === "/opt/homebrew/bin/git",
    });
    expect(result).toEqual({ runnable: true, bin: "/opt/homebrew/bin/git", cltShim: false });
    expect(execExternal).not.toHaveBeenCalled();
  });

  it("allows the shim when a developer directory is already on disk", async () => {
    const result = await assessGitAvailability({
      ...shimOnly,
      dirExists: (file: string) => file === "/Library/Developer/CommandLineTools",
    });
    expect(result.runnable).toBe(true);
    expect(result.cltShim).toBe(false);
    expect(execExternal).not.toHaveBeenCalled();
  });

  it("caches the shim decision until the cache is cleared", async () => {
    const first = await assessGitAvailability(shimOnly);
    const second = await assessGitAvailability({ ...shimOnly, fresh: false });
    expect(first.cltShim).toBe(true);
    expect(second).toEqual(first);
    expect(execExternal).toHaveBeenCalledTimes(1);
    clearGitAvailabilityCache();
    await assessGitAvailability(shimOnly);
    expect(execExternal).toHaveBeenCalledTimes(2);
  });
});

describe("assessGitAvailabilitySync", () => {
  it("does not run git when the injected xcode-select check fails", () => {
    const xcodeSelect = vi.fn(() => ({ ok: false, dir: null }));
    const result = assessGitAvailabilitySync({ ...shimOnly, xcodeSelect });
    expect(result.cltShim).toBe(true);
    expect(result.runnable).toBe(false);
    expect(xcodeSelect).toHaveBeenCalledTimes(1);
  });
});
