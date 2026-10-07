/**
 * Which assistant reviews an implementation before it asks to commit.
 *
 * Blank provider means the implementing agent reviews its own diff, which is the
 * default. Stored beside the other implement prefs in the vault config dir so the
 * launch sheet, the API, the plan payload and MCP all agree.
 */
import path from "node:path";
import { getNotesDir } from "@/lib/notes/dir";
import { safeReadJSON, writeAtomic, withMutex } from "@/lib/atomic-write";

const PREFS_VERSION = 1;
const PROVIDER_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
export const MAX_REVIEW_MODEL_LENGTH = 120;

export interface ImplementReviewPrefs {
  /** Paseo provider id, e.g. `codex`. Blank = the implementing agent reviews. */
  provider: string;
  /** Provider-specific model id. Blank = that provider's default. */
  model: string;
}

export const DEFAULT_IMPLEMENT_REVIEW_PREFS: ImplementReviewPrefs = { provider: "", model: "" };

interface StoredPrefs {
  version: number;
  prefs: Partial<ImplementReviewPrefs>;
}

function prefsFilePath(): string {
  return path.join(getNotesDir(), ".config", "implement-review.json");
}

/** A model only means something for a provider, so anything without a valid one resets to the default. */
export function normalizeImplementReviewPrefs(input: Partial<ImplementReviewPrefs>): ImplementReviewPrefs {
  const provider = typeof input.provider === "string" ? input.provider.trim() : "";
  if (!PROVIDER_RE.test(provider)) return { ...DEFAULT_IMPLEMENT_REVIEW_PREFS };
  const model = typeof input.model === "string" ? input.model.trim().slice(0, MAX_REVIEW_MODEL_LENGTH) : "";
  return { provider, model };
}

export function readImplementReviewPrefs(): ImplementReviewPrefs {
  const stored = safeReadJSON<StoredPrefs | null>(prefsFilePath(), null);
  if (!stored || stored.version !== PREFS_VERSION || !stored.prefs) return { ...DEFAULT_IMPLEMENT_REVIEW_PREFS };
  return normalizeImplementReviewPrefs(stored.prefs);
}

/**
 * Apply a partial update. Changing the provider without naming a model clears the
 * model, because model ids are provider-specific and a stale one would fail at dispatch.
 */
export async function saveImplementReviewPrefs(patch: Partial<ImplementReviewPrefs>): Promise<ImplementReviewPrefs> {
  const file = prefsFilePath();
  return withMutex(file, async () => {
    const current = readImplementReviewPrefs();
    const provider = patch.provider ?? current.provider;
    const providerChanged = patch.provider !== undefined && patch.provider.trim() !== current.provider;
    const model = patch.model ?? (providerChanged ? "" : current.model);
    const next = normalizeImplementReviewPrefs({ provider, model });
    const payload: StoredPrefs = { version: PREFS_VERSION, prefs: next };
    await writeAtomic(file, JSON.stringify(payload, null, 2));
    return next;
  });
}

/** What the implementing agent sees in the plan payload: `null` means "review your own diff". */
export function reviewerForPlan(prefs: ImplementReviewPrefs): { provider: string; model: string | null } | null {
  return prefs.provider ? { provider: prefs.provider, model: prefs.model || null } : null;
}
