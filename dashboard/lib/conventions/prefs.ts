/**
 * Conventions preferences, persisted beside the other poller prefs in the
 * vault config dir so the API, the MCP tool and the UI agree.
 *
 * Unlike auto-PR-review there is no env fallback: this feature is on by
 * default (it only reads PR comments and makes one model call per repo per
 * interval), and the model/provider choice is a per-feature setting, not a
 * machine-wide one.
 */
import path from "node:path";
import { safeReadJSON, withMutex, writeAtomic } from "@/lib/atomic-write";
import { AI_PROVIDER_IDS, normalizeAiProvider } from "@/lib/ai/preference";
import { getNotesDir } from "@/lib/notes/dir";
import type { ConventionsPrefs } from "./types";

const PREFS_VERSION = 1;

export const DEFAULT_CONVENTIONS_PREFS: ConventionsPrefs = {
  enabled: true,
  prLimit: 30,
  minIntervalHours: 12,
  provider: "",
  model: "",
};

interface StoredPrefs {
  version: number;
  prefs: Partial<ConventionsPrefs>;
}

export function conventionsPrefsFilePath(): string {
  return path.join(getNotesDir(), ".config", "conventions-prefs.json");
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

/** Coerce anything into a valid prefs object. Unknown providers fall back to default. */
export function normalizeConventionsPrefs(
  input: Partial<ConventionsPrefs> | null | undefined,
  base: ConventionsPrefs = DEFAULT_CONVENTIONS_PREFS,
): ConventionsPrefs {
  const src = input ?? {};
  const provider = src.provider === undefined ? base.provider : normalizeAiProvider(src.provider) ?? "";
  return {
    enabled: typeof src.enabled === "boolean" ? src.enabled : base.enabled,
    prLimit: clampInt(src.prLimit, 5, 50, base.prLimit),
    minIntervalHours: clampInt(src.minIntervalHours, 1, 168, base.minIntervalHours),
    provider: AI_PROVIDER_IDS.includes(provider as never) ? provider : "",
    model: typeof src.model === "string" ? src.model.trim().slice(0, 120) : base.model,
  };
}

export function readConventionsPrefs(): ConventionsPrefs {
  const stored = safeReadJSON<StoredPrefs | null>(conventionsPrefsFilePath(), null);
  if (!stored || stored.version !== PREFS_VERSION || !stored.prefs || typeof stored.prefs !== "object") {
    return { ...DEFAULT_CONVENTIONS_PREFS };
  }
  return normalizeConventionsPrefs(stored.prefs);
}

export async function saveConventionsPrefs(patch: Partial<ConventionsPrefs>): Promise<ConventionsPrefs> {
  const prefs = normalizeConventionsPrefs(patch, readConventionsPrefs());
  const file = conventionsPrefsFilePath();
  await withMutex(file, async () => {
    await writeAtomic(file, JSON.stringify({ version: PREFS_VERSION, prefs } satisfies StoredPrefs, null, 2));
  });
  return prefs;
}
