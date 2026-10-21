import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { worktreeXcodeCaches, xcodeBuildActive } from "./worktree-xcode-cache";

const exec = vi.hoisted(() => vi.fn());
vi.mock("@/lib/exec-external", () => ({ execExternal: exec }));
let home: string;
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "xcode-cache-")));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(home, { recursive: true, force: true }); });
function cache(name: string, info = true): string {
  const directory = path.join(home, "Library/Developer/Xcode/DerivedData", name);
  fs.mkdirSync(directory, { recursive: true });
  if (info) fs.writeFileSync(path.join(directory, "info.plist"), "fixture");
  return directory;
}
it("selects only caches whose workspace belongs to this checkout", async () => {
  const owned = cache("owned"), other = cache("other");
  cache("ModuleCache.noindex", false);
  exec.mockImplementation(async (_file: string, args: string[]) => ({
    stdout: args.at(-1) === path.join(owned, "info.plist") ? "/repo/task/ios/App.xcworkspace" : "/repo/task-other/ios/App.xcworkspace",
  }));
  expect(await worktreeXcodeCaches("/repo/task")).toEqual([owned]);
  expect(fs.existsSync(other)).toBe(true);
});
it("keeps unreadable ownership and symlinked cache directories", async () => {
  cache("unreadable");
  const outside = path.join(home, "outside");
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(home, "Library/Developer/Xcode/DerivedData/link"));
  exec.mockRejectedValue(new Error("Invalid plist"));
  expect(await worktreeXcodeCaches("/repo/task")).toEqual([]);
});
it.each(["Xcode", "xcodebuild", "clang", "swift-frontend", "XCBBuildService"])("detects active %s", async (name) => {
  exec.mockResolvedValue({ stdout: "/usr/bin/other\n/Applications/Xcode.app/Contents/Developer/usr/bin/" + name });
  expect(await xcodeBuildActive()).toBe(true);
});
it("fails closed if process inspection fails", async () => {
  exec.mockResolvedValue({ stdout: "" });
  await expect(xcodeBuildActive()).rejects.toThrow("Could not inspect");
});
