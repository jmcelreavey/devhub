import type { ReleaseEntry } from "@shared/release-notes/index.mjs";

export interface ReleaseNotesPayload {
  currentVersion: string;
  releases: ReleaseEntry[];
}

export const RELEASE_NOTES_EVENT = "devhub:whats-new";

export function openReleaseNotes(): void {
  window.dispatchEvent(new Event(RELEASE_NOTES_EVENT));
}

interface ReleaseNotesState {
  lastVersion: string | null;
  seen: string[];
  dismissed: string[];
}

type ReleaseNotesStorage = Pick<Storage, "getItem" | "setItem">;

function releaseNotesKey(desktop: boolean): string {
  return `devhub:release-notes:${desktop ? "desktop" : "web"}`;
}

function readReleaseNotesState(storage: ReleaseNotesStorage, key: string): ReleaseNotesState {
  const raw = storage.getItem(key);
  let parsed: unknown = null;
  if (raw) {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  }
  const state = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  return {
    lastVersion: typeof state.lastVersion === "string" ? state.lastVersion : null,
    seen: Array.isArray(state.seen) ? state.seen.filter((item): item is string => typeof item === "string") : [],
    dismissed: Array.isArray(state.dismissed) ? state.dismissed.filter((item): item is string => typeof item === "string") : [],
  };
}

export function observeReleaseVersion(storage: ReleaseNotesStorage, version: string, desktop: boolean): boolean {
  const key = releaseNotesKey(desktop);
  try {
    const state = readReleaseNotesState(storage, key);
    const show = state.lastVersion !== null && state.lastVersion !== version && !state.seen.includes(version) && !state.dismissed.includes(version);
    storage.setItem(key, JSON.stringify({ ...state, lastVersion: version, seen: [...new Set([...state.seen, version])].slice(-100) }));
    return show;
  } catch {
    return false;
  }
}

export function dismissReleaseVersion(storage: ReleaseNotesStorage, version: string, desktop: boolean): boolean {
  const key = releaseNotesKey(desktop);
  try {
    const state = readReleaseNotesState(storage, key);
    storage.setItem(key, JSON.stringify({ ...state, dismissed: [...new Set([...state.dismissed, version])] }));
    return true;
  } catch {
    return false;
  }
}

export function isReleaseVersionDismissed(storage: ReleaseNotesStorage, version: string, desktop: boolean): boolean {
  try {
    return readReleaseNotesState(storage, releaseNotesKey(desktop)).dismissed.includes(version);
  } catch {
    return false;
  }
}
