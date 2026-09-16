/**
 * Persist auto-PR-review poller prefs in the vault config dir so MCP / API / UI
 * agree. Until the first save, values derive from env so existing Mac setups
 * keep working without a prefs file.
 *
 * Once `notes/.config/auto-pr-review.json` exists, prefs win over env for
 * `enabled` / `always`. Interval / timezone / hours stay env-only.
 */
import path from "node:path";
import { getNotesDir } from "@/lib/notes/dir";
import { safeReadJSON, writeAtomic, withMutex } from "@/lib/atomic-write";

const PREFS_VERSION = 1;

export interface AutoPrReviewPrefs {
  enabled: boolean;
  always: boolean;
}

export interface AutoPrReviewPrefsResolved extends AutoPrReviewPrefs {
  source: "prefs" | "env";
}

interface StoredPrefs {
  version: number;
  prefs: AutoPrReviewPrefs;
}

export function envFlagOn(raw: string | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function prefsFromEnv(): AutoPrReviewPrefs {
  return {
    enabled: envFlagOn(process.env.DEVHUB_AUTO_PR_REVIEW),
    always: envFlagOn(process.env.DEVHUB_AUTO_PR_REVIEW_ALWAYS),
  };
}

export function autoPrReviewPrefsFilePath(): string {
  return path.join(getNotesDir(), ".config", "auto-pr-review.json");
}

/** Read prefs from disk, or env when no valid prefs file exists yet. */
export function readAutoPrReviewPrefs(): AutoPrReviewPrefsResolved {
  const stored = safeReadJSON<StoredPrefs | null>(autoPrReviewPrefsFilePath(), null);
  if (!stored || stored.version !== PREFS_VERSION || !stored.prefs || typeof stored.prefs !== "object") {
    return { ...prefsFromEnv(), source: "env" };
  }
  return {
    enabled: Boolean(stored.prefs.enabled),
    always: Boolean(stored.prefs.always),
    source: "prefs",
  };
}

/**
 * Merge a partial update onto current prefs (env fallback before first write)
 * and persist. After this, source is always `"prefs"`.
 */
export async function saveAutoPrReviewPrefs(
  patch: Partial<AutoPrReviewPrefs>,
): Promise<AutoPrReviewPrefsResolved> {
  const current = readAutoPrReviewPrefs();
  const prefs: AutoPrReviewPrefs = {
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : current.enabled,
    always: typeof patch.always === "boolean" ? patch.always : current.always,
  };
  const payload: StoredPrefs = { version: PREFS_VERSION, prefs };
  const file = autoPrReviewPrefsFilePath();
  await withMutex(file, async () => {
    await writeAtomic(file, JSON.stringify(payload, null, 2));
  });
  return { ...prefs, source: "prefs" };
}
