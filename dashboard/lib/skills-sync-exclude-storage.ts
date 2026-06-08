import { readExcludedIdsFromStorage, writeExcludedIdsToStorage } from "./sync-exclude-storage";

/** Browser key for skills excluded from Sync Skills / Collect Skills (dashboard UI only). */
export const SKILLS_SYNC_EXCLUDE_STORAGE_KEY = "devhub:skills-sync-exclude";
export const AGENTS_SYNC_EXCLUDE_STORAGE_KEY = "devhub:agents-sync-exclude";

/** Same-tab + other-tab listeners use this event name after `writeExcludedSkillIdsToStorage`. */
export const SKILLS_SYNC_EXCLUDE_CHANGED_EVENT = "devhub-skills-sync-exclude-change";
export const AGENTS_SYNC_EXCLUDE_CHANGED_EVENT = "devhub-agents-sync-exclude-change";

export function parseExcludeCsv(csv: string): string[] {
  return csv
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function readExcludedSkillIdsFromStorage(): string[] {
  return readExcludedIdsFromStorage(SKILLS_SYNC_EXCLUDE_STORAGE_KEY);
}

export function readExcludedAgentIdsFromStorage(): string[] {
  return readExcludedIdsFromStorage(AGENTS_SYNC_EXCLUDE_STORAGE_KEY);
}

export function writeExcludedSkillIdsToStorage(ids: string[]): void {
  writeExcludedIdsToStorage(SKILLS_SYNC_EXCLUDE_STORAGE_KEY, SKILLS_SYNC_EXCLUDE_CHANGED_EVENT, ids);
}

export function writeExcludedAgentIdsToStorage(ids: string[]): void {
  writeExcludedIdsToStorage(AGENTS_SYNC_EXCLUDE_STORAGE_KEY, AGENTS_SYNC_EXCLUDE_CHANGED_EVENT, ids);
}
