import fs from "node:fs";
import path from "node:path";

function ownerAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function isStale(file: string): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { pid?: unknown };
    return typeof parsed.pid === "number" && Number.isInteger(parsed.pid) && parsed.pid > 0 && !ownerAlive(parsed.pid);
  } catch {
    return false;
  }
}

function releaseDirectory(dir: string, owner: string): void {
  try {
    fs.unlinkSync(path.join(dir, owner));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    fs.rmdirSync(dir);
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
  }
}

function createLockFile(file: string, body: string, token: string): void {
  const temp = `${file}.${token}.tmp`;
  fs.mkdirSync(temp, { mode: 0o700 });
  try {
    fs.writeFileSync(path.join(temp, token), body, { mode: 0o600 });
    fs.renameSync(temp, file);
  } catch (error) {
    if (["ENOTEMPTY", "EEXIST", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      throw Object.assign(new Error("busy"), { code: "EEXIST" });
    }
    throw error;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function recoverStaleOwners(file: string): void {
  try {
    if (!fs.lstatSync(file).isDirectory()) return;
    for (const owner of fs.readdirSync(file)) {
      if (/^[\w-]+$/.test(owner) && isStale(path.join(file, owner))) releaseDirectory(file, owner);
    }
  } catch (error) {
    if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
  }
}

export function tryAcquireProcessDirectoryLock(file: string): ((() => void) & { owner: string }) | null {
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const body = JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), token });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      createLockFile(file, body, token);
      return Object.assign(() => releaseDirectory(file, token), { owner: token });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    recoverStaleOwners(file);
  }
  return null;
}
