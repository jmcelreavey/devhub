import fs from "node:fs";
import path from "node:path";
import { getHome } from "@/lib/content/dirs";
import { safeReadJSON, withMutex, writeAtomic } from "@/lib/atomic-write";
import {
  type OneTimeRecord,
  type ShareRecord,
  type VaultId,
  oneTimeIsExpired,
  shareKey,
} from "@/lib/share/share-public";

const STATE_DIR = path.join(getHome(), ".local/state/devhub");
const SHARES_FILE = path.join(STATE_DIR, "shares.json");
const MUTEX_KEY = "share-store";

interface SharesFile {
  version: 2;
  shares: ShareRecord[];
  oneTime: OneTimeRecord[];
}

/** The v1 shape, kept only so the migration has something to name. */
interface SharesFileV1 {
  version: 1;
  shares: ShareRecord[];
}

function defaultFile(): SharesFile {
  return { version: 2, shares: [], oneTime: [] };
}

/**
 * Read the registry, upgrading a v1 file in place.
 *
 * The version check has to migrate rather than fall through to `defaultFile()`:
 * that path silently discards every live gist the user has published, and they
 * would only find out when `/shared` came up empty and the gists were orphaned
 * on GitHub with nothing left to delete them.
 */
function readFile(): SharesFile {
  const parsed = safeReadJSON<SharesFile | SharesFileV1>(SHARES_FILE, defaultFile());
  if (!parsed || !Array.isArray(parsed.shares)) return defaultFile();

  if (parsed.version === 1) {
    return { version: 2, shares: parsed.shares, oneTime: [] };
  }
  if (parsed.version !== 2) return defaultFile();

  return { ...parsed, oneTime: Array.isArray(parsed.oneTime) ? parsed.oneTime : [] };
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

/** Remove all gist share records, returning the records that were removed. */
export async function clearShares(): Promise<ShareRecord[]> {
  return withMutex(MUTEX_KEY, async () => {
    const file = readFile();
    if (file.shares.length === 0) return [];
    // Only the gist half — one-time links are a separate list with its own
    // "remove all", and wiping both from one button would be a nasty surprise.
    await writeFile({ ...file, shares: [] });
    return file.shares;
  });
}

/* ------------------------------------------------------------------ *
 * One-time links
 * ------------------------------------------------------------------ */

/** Newest first. Expired records are filtered out but not yet deleted. */
export function listOneTimeShares(now = Date.now()): OneTimeRecord[] {
  return readFile()
    .oneTime.filter((record) => !oneTimeIsExpired(record, now))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function getOneTimeShare(id: string): OneTimeRecord | null {
  return readFile().oneTime.find((record) => record.id === id) ?? null;
}

export async function addOneTimeShare(record: OneTimeRecord): Promise<OneTimeRecord> {
  return withMutex(MUTEX_KEY, async () => {
    const file = readFile();
    await writeFile({ ...file, oneTime: [...file.oneTime, record] });
    return record;
  });
}

/** Drop a record by id. Returns it so the caller can revoke the paste. */
export async function removeOneTimeShare(id: string): Promise<OneTimeRecord | null> {
  return withMutex(MUTEX_KEY, async () => {
    const file = readFile();
    const removed = file.oneTime.find((record) => record.id === id) ?? null;
    if (!removed) return null;
    await writeFile({ ...file, oneTime: file.oneTime.filter((r) => r.id !== id) });
    return removed;
  });
}

/** Remove every one-time record, returning them for revocation. */
export async function clearOneTimeShares(): Promise<OneTimeRecord[]> {
  return withMutex(MUTEX_KEY, async () => {
    const file = readFile();
    if (file.oneTime.length === 0) return [];
    await writeFile({ ...file, oneTime: [] });
    return file.oneTime;
  });
}

/**
 * Forget records the instance has already dropped.
 *
 * Purely local bookkeeping — the paste is gone server-side either way, so there
 * is nothing to revoke and no error worth reporting.
 */
export async function pruneExpiredOneTimeShares(now = Date.now()): Promise<number> {
  return withMutex(MUTEX_KEY, async () => {
    const file = readFile();
    const kept = file.oneTime.filter((record) => !oneTimeIsExpired(record, now));
    if (kept.length === file.oneTime.length) return 0;
    await writeFile({ ...file, oneTime: kept });
    return file.oneTime.length - kept.length;
  });
}
