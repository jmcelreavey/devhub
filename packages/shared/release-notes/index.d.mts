export interface ReleaseEntry {
  version: string;
  date: string | null;
  markdown: string;
  highlights: string[];
}
export const RELEASE_VERSION_PATTERN: RegExp;
export function normaliseReleaseVersion(value: unknown): string | null;
export function parseChangelog(source: string): ReleaseEntry[];
export function requireReleaseNotes(source: string, version: string): string;
