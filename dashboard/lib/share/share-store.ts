import fs from "node:fs";
import path from "node:path";
import { getHome } from "@/lib/content-dirs";
import { safeReadJSON, withMutex, writeAtomic } from "@/lib/atomic-write";
import { type ShareRecord, type VaultId, shareKey } from "@/lib/share/share-public";

const STATE_DIR = path.join(getHome(), ".local/state/devhub");
const SHARES_FILE = path.join(STATE_DIR, "shares.json");
const MUTEX_KEY = "share-store";

interface SharesFile {
  version: 1;
  shares: ShareRecord[];
}

function defaultFile(): SharesFile {
  return { version: 1, shares: [] };
}

function readFile(): SharesFile {
  const parsed = safeReadJSON<SharesFile>(SHARES_FILE, defaultFile());
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.shares)) {
    return defaultFile();
  }
  return parsed;
}

async function writeFile(file: SharesFile): Promise<void> {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  await writeAtomic(SHARES_FILE, JSON.stringify(file, null, 2) + "\n");
}

export function listShares(): ShareRecord[] {
  return readFile().shares.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getShare(vault: VaultId, sharePath: string): ShareRecord | null {
  const key = shareKey(vault, sharePath);
  return readFile().shares.find((s) => s.key === key) ?? null;
}

/** Insert or replace a share record by key. */
export async function upsertShare(record: ShareRecord): Promise<ShareRecord> {
  return withMutex(MUTEX_KEY, async () => {
    const file = readFile();
    const next = file.shares.filter((s) => s.key !== record.key);
    next.push(record);
    await writeFile({ ...file, shares: next });
    return record;
  });
}

/** Remove a share record by key. Returns the removed record, if any. */
export async function removeShare(vault: VaultId, sharePath: string): Promise<ShareRecord | null> {
  const key = shareKey(vault, sharePath);
  return withMutex(MUTEX_KEY, async () => {
    const file = readFile();
    const removed = file.shares.find((s) => s.key === key) ?? null;
    if (!removed) return null;
    await writeFile({ ...file, shares: file.shares.filter((s) => s.key !== key) });
    return removed;
  });
}

/** Remove all share records, returning the records that were removed. */
export async function clearShares(): Promise<ShareRecord[]> {
  return withMutex(MUTEX_KEY, async () => {
    const file = readFile();
    if (file.shares.length === 0) return [];
    await writeFile(defaultFile());
    return file.shares;
  });
}
