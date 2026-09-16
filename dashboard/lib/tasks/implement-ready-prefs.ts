/**
 * Persist implement-ready hard-block preference in the vault config dir so
 * MCP / API / UI agree. Default is warn-only (hardBlock: false).
 */
import path from "node:path";
import { getNotesDir } from "@/lib/notes/dir";
import { safeReadJSON, writeAtomic, withMutex } from "@/lib/atomic-write";

const PREFS_VERSION = 1;

export interface ImplementReadyPrefs {
  hardBlock: boolean;
}

export const DEFAULT_IMPLEMENT_READY_PREFS: ImplementReadyPrefs = {
  hardBlock: false,
};

interface StoredPrefs {
  version: number;
  prefs: ImplementReadyPrefs;
}

function prefsFilePath(): string {
  return path.join(getNotesDir(), ".config", "implement-ready.json");
}

export function readImplementReadyPrefs(): ImplementReadyPrefs {
  const stored = safeReadJSON<StoredPrefs | null>(prefsFilePath(), null);
  if (!stored || stored.version !== PREFS_VERSION || !stored.prefs) {
    return { ...DEFAULT_IMPLEMENT_READY_PREFS };
  }
  return {
    hardBlock: Boolean(stored.prefs.hardBlock),
  };
}

export async function saveImplementReadyPrefs(prefs: ImplementReadyPrefs): Promise<void> {
  const payload: StoredPrefs = { version: PREFS_VERSION, prefs };
  const file = prefsFilePath();
  await withMutex(file, async () => {
    await writeAtomic(file, JSON.stringify(payload, null, 2));
  });
}
