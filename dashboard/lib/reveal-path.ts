import { spawn } from "node:child_process";

/** Platform-appropriate label for "open this folder in the OS file manager". */
export function revealPathLabel(platform: NodeJS.Platform = process.platform): string {
  if (platform === "darwin") return "Finder";
  if (platform === "win32") return "Explorer";
  return "Show folder";
}

/**
 * Open a directory (or file) in the OS file manager.
 * Fire-and-forget — does not wait for the file manager to exit.
 */
export function revealPath(absolutePath: string, platform: NodeJS.Platform = process.platform): void {
  if (platform === "darwin") {
    spawn("open", [absolutePath], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  if (platform === "win32") {
    spawn("explorer", [absolutePath], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn("xdg-open", [absolutePath], { detached: true, stdio: "ignore" }).unref();
}
