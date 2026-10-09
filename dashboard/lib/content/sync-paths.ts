/** Repo-relative paths included in scoped content sync (commit + push). */
export const CONTENT_SYNC_PATHS = ["notes", "collections", "tasks", "docs", "diagrams", "upstarts"] as const;

export type ContentSyncPath = (typeof CONTENT_SYNC_PATHS)[number];

/** Timers live in `tasks/.local/` and `tasks/<profile>/.local/`. They stay on this machine. */
export function isTaskTimerOverlay(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  return /(^|\/)tasks\/(\.local(\/|$)|[^/]+\/\.local(\/|$))/.test(normalized);
}

export function isContentSyncPath(filePath: string): boolean {
  if (isTaskTimerOverlay(filePath)) return false;
  return CONTENT_SYNC_PATHS.some(
    (prefix) => filePath === prefix || filePath.startsWith(`${prefix}/`),
  );
}

/**
 * Whether any changed path could alter a built bundle. Everything outside the
 * content folders can, so this is the same split the pre-push hook uses for
 * `DEVHUB_PREPUSH=content`: a range of notes/tasks/docs commits builds the same app.
 */
export function touchesBuildPaths(changedPaths: readonly string[]): boolean {
  return changedPaths.some((file) => !isContentSyncPath(file));
}

/** Paths from `git diff --name-only -z` output. */
export function parseNulSeparatedPaths(stdout: string): string[] {
  return stdout.split("\0").filter(Boolean);
}

const CONTENT_SYNC_LABEL: Record<ContentSyncPath, string> = {
  notes: "notes",
  collections: "checklists",
  tasks: "tasks",
  docs: "docs",
  diagrams: "diagrams",
  upstarts: "upstarts",
};

/** Commit subject naming only the folders that actually have staged files. */
export function contentSyncCommitMessage(files: string[], date = new Date().toISOString().slice(0, 10)): string {
  const present = new Set(files.map((file) => file.split("/")[0]));
  const labels = CONTENT_SYNC_PATHS.filter((folder) => present.has(folder)).map((folder) => CONTENT_SYNC_LABEL[folder]);
  const list = labels.length === 0
    ? "content"
    : labels.length === 1
      ? labels[0]
      : labels.length === 2
        ? `${labels[0]} and ${labels[1]}`
        : `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
  return `chore(content): sync ${list} ${date}`;
}
