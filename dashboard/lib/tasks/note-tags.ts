import fs from "node:fs";
import path from "node:path";
import { extractTags } from "@shared/entity-note/index.ts";
import { readTaskNoteWithMigration } from "@shared/task-note/sections.ts";
import { getNotesDir } from "@/lib/notes/dir";

/** Task-note files are `task-notes/<YYYY-MM-DD>-<taskId>.json`. */
const NOTE_FILE = /^\d{4}-\d{2}-\d{2}-(.+)\.json$/;

let cache: { key: string; map: Record<string, string[]> } | null = null;

/**
 * taskId → tags from its task note (metadata tags + #tags in the note title), lower-cased.
 * Lets the Work tag filter match tags that live only in the note. Cached until any note changes.
 */
export function taskNoteTags(notesDir = getNotesDir()): Record<string, string[]> {
  const dir = path.join(notesDir, "task-notes");
  if (!fs.existsSync(dir)) return {};
  const files = fs.readdirSync(dir).filter((name) => NOTE_FILE.test(name));
  const stats = files.map((name) => [name, fs.statSync(path.join(dir, name)).mtimeMs] as const);
  const key = `${dir}|${stats.map(([n, m]) => `${n}:${m}`).join(",")}`;
  if (cache?.key === key) return cache.map;
  const map: Record<string, string[]> = {};
  for (const [name] of stats) {
    try {
      const view = readTaskNoteWithMigration(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as unknown[]);
      const tags = [...new Set([...(view.meta?.tags ?? []), ...extractTags(view.title ?? "")].map((tag) => tag.replace(/^#/, "").toLowerCase()))];
      if (!tags.length) continue;
      const taskId = NOTE_FILE.exec(name)![1];
      map[taskId] = [...new Set([...(map[taskId] ?? []), ...tags])];
    } catch { /* unreadable note: skip */ }
  }
  cache = { key, map };
  return map;
}
