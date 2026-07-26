/** Shared localStorage helpers for catalog sync exclude lists (skills, agents, MCP). */

export function readExcludedIdsFromStorage(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((s) => s.trim());
  } catch {
    return [];
  }
}

export function writeExcludedIdsToStorage(key: string, eventName: string, ids: string[]): void {
  if (typeof window === "undefined") return;
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const s of ids.map((x) => x.trim()).filter(Boolean)) {
    if (seen.has(s)) continue;
    seen.add(s);
    unique.push(s);
  }
  try {
    localStorage.setItem(key, JSON.stringify(unique));
    window.dispatchEvent(new CustomEvent(eventName));
  } catch {
    // ignore quota / private mode
  }
}
