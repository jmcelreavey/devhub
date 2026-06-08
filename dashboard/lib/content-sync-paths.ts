/** Repo-relative paths included in scoped content sync (commit + push). */
export const CONTENT_SYNC_PATHS = ["notes", "collections", "tasks", "docs"] as const;

export type ContentSyncPath = (typeof CONTENT_SYNC_PATHS)[number];

export function isContentSyncPath(filePath: string): boolean {
  return CONTENT_SYNC_PATHS.some(
    (prefix) => filePath === prefix || filePath.startsWith(`${prefix}/`),
  );
}
