import fs from "node:fs";
import path from "node:path";
import { writeAtomicNow as sharedWriteAtomicNow } from "../../shared/vault/atomic-write.ts";

const writeChain = new Map<string, Promise<unknown>>();

function writeAtomicSync(filePath: string, data: string): void {
  sharedWriteAtomicNow(filePath, data);
}

export function writeAtomic(filePath: string, data: string): Promise<void> {
  const key = path.resolve(filePath);
  const prev = writeChain.get(key) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(() => writeAtomicSync(filePath, data));
  const cleanup = next
    .finally(() => {
      if (writeChain.get(key) === cleanup) writeChain.delete(key);
    })
    .catch(() => undefined);
  writeChain.set(key, cleanup);
  return next;
}

export function writeAtomicNow(filePath: string, data: string): void {
  writeAtomicSync(filePath, data);
}

// Per-key in-memory mutex for read-modify-write cycles. The atomic-write
// queue protects on-disk durability; this protects against two route handlers
// both reading the same file before either writes.
const mutexChain = new Map<string, Promise<unknown>>();

export function withMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = mutexChain.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(() => fn());
  const cleanup = next
    .finally(() => {
      if (mutexChain.get(key) === cleanup) mutexChain.delete(key);
    })
    .catch(() => undefined);
  mutexChain.set(key, cleanup);
  return next;
}

export function safeReadJSON<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    console.error(`safeReadJSON: failed to read ${filePath}:`, err);
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    const corruptPath = `${filePath}.corrupt-${Date.now()}.json`;
    console.error(
      `safeReadJSON: corrupt JSON in ${filePath}, renaming to ${corruptPath}:`,
      err,
    );
    try {
      fs.renameSync(filePath, corruptPath);
    } catch (renameErr) {
      console.error(`safeReadJSON: failed to rename corrupt file:`, renameErr);
    }
    return fallback;
  }
}
