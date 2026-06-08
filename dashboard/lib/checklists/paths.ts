import type { MasterList } from "./types";

/** Decode URI segments and normalize slashes for scope / note paths. */
export function normalizeScopePath(raw: string): string {
  return raw
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

/** Longest matching scope wins (e.g. garden/flower bed before garden). */
export function getMasterForNotePath(notePath: string, masters: MasterList[]): MasterList | undefined {
  const normalized = normalizeScopePath(notePath);
  const prefixes: string[] = [];
  if (normalized) {
    const parts = normalized.split("/");
    for (let i = parts.length; i >= 1; i--) {
      prefixes.push(parts.slice(0, i).join("/"));
    }
  }
  prefixes.push("");

  for (const prefix of prefixes) {
    const matches = masters.filter((m) => m.scopePath === prefix);
    if (matches.length === 0) continue;
    return matches.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )[0];
  }
  return undefined;
}

export function parentScopePath(notePath: string): string {
  const normalized = normalizeScopePath(notePath);
  const parts = normalized.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

/** UI label for a master checklist scope (empty = all notes). */
export function formatMasterScopeDisplay(scopePath: string): string {
  return scopePath ? `Folder: ${scopePath}` : "All notes";
}

/** Error text when a scope is already claimed by another master list. */
export function masterScopeConflictLabel(scopePath: string): string {
  return scopePath ? `scope "${scopePath}"` : "all notes";
}
