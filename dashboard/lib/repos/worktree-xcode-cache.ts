import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execExternal } from "@/lib/exec-external";

function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Xcode keys DerivedData by checkout path, so every worktree can leave several GiB behind. */
export async function worktreeXcodeCaches(checkout: string): Promise<string[]> {
  if (process.platform !== "darwin") return [];
  const root = path.join(os.homedir(), "Library/Developer/Xcode/DerivedData");
  if (!fs.existsSync(root) || fs.realpathSync(root) !== root) return [];
  const caches: string[] = [];
  for (const entry of await fs.promises.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(root, entry.name);
    const info = path.join(directory, "info.plist");
    if (!fs.existsSync(info)) continue; // Shared SDK/module caches have no checkout owner.
    try {
      const result = await execExternal("/usr/bin/plutil", ["-extract", "WorkspacePath", "raw", "-o", "-", info], { timeoutMs: 5000 });
      const workspace = result.stdout.trim();
      if (path.isAbsolute(workspace) && inside(checkout, workspace)) caches.push(directory);
    } catch {
      // Missing/unreadable ownership is never a reason to delete a shared cache.
    }
  }
  return caches;
}

export async function xcodeBuildActive(): Promise<boolean> {
  const { stdout } = await execExternal("ps", ["-axo", "comm="], { timeoutMs: 5000 });
  if (!stdout.trim()) throw new Error("Could not inspect Xcode processes");
  return stdout.split("\n").some((command) => /\/(Xcode|xcodebuild|clang[^/]*|swift[^/]*|XCBBuildService|xcsbuildd|ibtoold|actool)$/.test(command.trim()));
}
