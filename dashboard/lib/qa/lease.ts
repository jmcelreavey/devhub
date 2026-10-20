import fs from "node:fs";
import path from "node:path";
import { qaDir } from "./store";

export function processAlive(pid: number | undefined): boolean {
  if (!pid || !Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
export function claimQaLease(id: string, notesDir: string): () => void {
  const file = path.join(qaDir(notesDir), "active.lock");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (fs.existsSync(file)) {
    let owner: { pid?: number } = {};
    try { owner = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* A just-created lock can still be empty. */ }
    const age = Date.now() - fs.statSync(file).mtimeMs;
    if (processAlive(owner.pid) || (!owner.pid && age < 660000)) throw new Error("A QA runner already owns this workspace.");
    fs.unlinkSync(file);
  }
  // Exclusive creation also protects separate dashboard processes using the same vault.
  const fd = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify({ id, pid: process.pid })); } finally { fs.closeSync(fd); }
  return () => {
    try {
      const owner = JSON.parse(fs.readFileSync(file, "utf8")) as { id: string };
      if (owner.id === id) fs.unlinkSync(file);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  };
}
