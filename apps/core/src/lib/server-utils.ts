import fs from "node:fs";
import path from "node:path";

export function copyTreeSync(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyTreeSync(s, d);
    else if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(s), d);
    else fs.copyFileSync(s, d);
  }
}

export function safeRemovePath(target: string): void {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isDirectory() || stat.isSymbolicLink()) {
      fs.rmSync(target, { recursive: true, force: true });
    } else {
      fs.rmSync(target, { force: true });
    }
  } catch {
    // Path does not exist — nothing to remove.
  }
}
