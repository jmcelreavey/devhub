// Briefing preferences — the user-configurable layer that drives what the
// briefing page shows and where it pulls data from. Stored as a JSON file in
// the notes config directory so it survives restarts and syncs with the repo.
//
// Client-safe types + constants live in briefing-prefs-shared.ts so client
// components can import them without pulling in node:fs.

import path from "node:path";
import { getRepoRoot } from "@/lib/notes-dir";
import { writeAtomic, safeReadJSON, withMutex } from "@/lib/atomic-write";
import {
  BRIEFING_SECTIONS,
  DEFAULT_SECTION_VISIBILITY,
  DEFAULT_BRIEFING_PREFS,
  type BriefingSectionId,
  type BriefingPrefs,
} from "@/lib/briefing-prefs-shared";

// Re-export client-safe values so existing server-side imports still work
export {
  BRIEFING_SECTIONS,
  DEFAULT_SECTION_VISIBILITY,
  DEFAULT_BRIEFING_PREFS,
} from "@/lib/briefing-prefs-shared";
export type {
  BriefingSectionId,
  BriefingSectionMeta,
  BriefingLocation,
  RssFeed,
  BriefingPrefs,
} from "@/lib/briefing-prefs-shared";

// ── File storage ─────────────────────────────────────────────────────────────

const PREFS_VERSION = 1;

interface StoredPrefs {
  version: number;
  prefs: BriefingPrefs;
}

function prefsFilePath(): string {
  return path.join(getRepoRoot(), "notes", ".config", "briefing-prefs.json");
}

/** Read prefs from disk, deep-merged over defaults so new fields always have a value. */
export function readBriefingPrefs(): BriefingPrefs {
  const stored = safeReadJSON<StoredPrefs | null>(prefsFilePath(), null);
  if (!stored || stored.version !== PREFS_VERSION || !stored.prefs) {
    return DEFAULT_BRIEFING_PREFS;
  }
  return mergePrefs(DEFAULT_BRIEFING_PREFS, stored.prefs);
}

/** Write prefs atomically. */
export async function saveBriefingPrefs(prefs: BriefingPrefs): Promise<void> {
  const payload: StoredPrefs = { version: PREFS_VERSION, prefs };
  const file = prefsFilePath();
  await withMutex(file, async () => {
    await writeAtomic(file, JSON.stringify(payload, null, 2));
  });
}

// ── Merge helpers ────────────────────────────────────────────────────────────

function mergePrefs(base: BriefingPrefs, incoming: Partial<BriefingPrefs>): BriefingPrefs {
  return {
    location: { ...base.location, ...incoming.location },
    eventSearchAreas: incoming.eventSearchAreas ?? base.eventSearchAreas,
    interests: incoming.interests ?? base.interests,
    techStack: incoming.techStack ?? base.techStack,
    hasKids: incoming.hasKids ?? base.hasKids,
    attractionsArea: incoming.attractionsArea ?? base.attractionsArea,
    newsFeeds: incoming.newsFeeds ?? base.newsFeeds,
    newsRegion: incoming.newsRegion ?? base.newsRegion,
    repoLanguages: incoming.repoLanguages ?? base.repoLanguages,
    gamingFeeds: incoming.gamingFeeds ?? base.gamingFeeds,
    sections: { ...base.sections, ...incoming.sections },
  };
}

/**
 * Validate and normalise a partial prefs update from the API.
 * Strips unknown keys, clamps numbers, fills missing section toggles.
 */
export function normalisePrefsUpdate(raw: Record<string, unknown>): Partial<BriefingPrefs> {
  const out: Partial<BriefingPrefs> = {};

  if (raw.location && typeof raw.location === "object") {
    const loc = raw.location as Record<string, unknown>;
    const lat = typeof loc.lat === "number" ? loc.lat : Number(loc.lat);
    const lon = typeof loc.lon === "number" ? loc.lon : Number(loc.lon);
    out.location = {
      name: String(loc.name ?? DEFAULT_BRIEFING_PREFS.location.name),
      lat: Number.isFinite(lat) ? lat : DEFAULT_BRIEFING_PREFS.location.lat,
      lon: Number.isFinite(lon) ? lon : DEFAULT_BRIEFING_PREFS.location.lon,
    };
  }
  if (Array.isArray(raw.eventSearchAreas)) {
    out.eventSearchAreas = raw.eventSearchAreas.map(String).filter(Boolean);
  }
  if (Array.isArray(raw.interests)) {
    out.interests = raw.interests.map(String).filter(Boolean);
  }
  if (Array.isArray(raw.techStack)) {
    out.techStack = raw.techStack.map(String).filter(Boolean);
  }
  if (typeof raw.hasKids === "boolean") out.hasKids = raw.hasKids;
  if (typeof raw.attractionsArea === "string") out.attractionsArea = raw.attractionsArea;
  if (Array.isArray(raw.newsFeeds)) {
    out.newsFeeds = raw.newsFeeds
      .filter((f): f is Record<string, unknown> => f != null && typeof f === "object")
      .map((f) => ({ url: String(f.url ?? ""), label: String(f.label ?? "Feed") }))
      .filter((f) => f.url);
  }
  if (typeof raw.newsRegion === "string") out.newsRegion = raw.newsRegion;
  if (Array.isArray(raw.repoLanguages)) {
    out.repoLanguages = raw.repoLanguages.map(String).filter(Boolean);
  }
  if (Array.isArray(raw.gamingFeeds)) {
    out.gamingFeeds = raw.gamingFeeds
      .filter((f): f is Record<string, unknown> => f != null && typeof f === "object")
      .map((f) => ({ url: String(f.url ?? ""), label: String(f.label ?? "Feed") }))
      .filter((f) => f.url);
  }
  if (raw.sections && typeof raw.sections === "object") {
    const sections = raw.sections as Record<string, unknown>;
    const validated: Partial<Record<BriefingSectionId, boolean>> = {};
    for (const s of BRIEFING_SECTIONS) {
      if (typeof sections[s.id] === "boolean") {
        validated[s.id] = sections[s.id] as boolean;
      }
    }
    out.sections = { ...DEFAULT_SECTION_VISIBILITY, ...validated };
  }

  return out;
}
