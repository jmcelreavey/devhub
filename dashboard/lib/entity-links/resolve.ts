/**
 * Resolve hop-around links for an entity by combining:
 *   - Stable note path conventions (task-notes / meetings / pr-reviews)
 *   - ## Links EntityRefs inside those notes
 *   - Task.links for edges that don't live in a note
 *
 * Used by /api/entity-links and (via client) EntityLinkChips / RelationsPanel.
 * MCP and plugins should prefer the shared EntityRef builders; this module is
 * the server-side read model.
 */

import fs from "node:fs";
import path from "node:path";
import { getNotesDir, getTasksDir } from "@/lib/content/dirs";
import { blocksToText } from "@/lib/markdown-convert";
import {
  defaultHrefForRef,
  entityKey,
  mergeEntityRefs,
  parseEntityLinksFromMarkdown,
  tagRefs,
  type EntityKind,
  type EntityRef,
} from "@/lib/entity-note";
import { meetingNotePath } from "@/lib/meeting-note";
import { taskNotePath } from "@/lib/task-note";
import { prNotePath } from "@/lib/pr-note";
import { todayISO } from "@/lib/utils";
import type { Task } from "@/lib/tasks/types";

export interface EntityLinksResult {
  entity: EntityRef;
  /** Notes that represent / link to this entity. */
  notes: EntityRef[];
  /** Other entities reachable from notes + task.links. */
  related: EntityRef[];
}

function noteHref(notePath: string): string {
  return defaultHrefForRef({ kind: "note", id: notePath, label: notePath }) ?? "/notes";
}

/**
 * Absolute path for a vault-relative note, or null if it escapes the vault.
 *
 * `id` reaches here straight from the /api/entity-links query string, so
 * `../../` would otherwise read any JSON file on the box.
 */
function noteFilePath(relPath: string): string | null {
  const root = path.resolve(getNotesDir());
  const full = path.resolve(root, `${relPath}.json`);
  return full === root || full.startsWith(root + path.sep) ? full : null;
}

function noteExists(relPath: string): boolean {
  const full = noteFilePath(relPath);
  return full != null && fs.existsSync(full);
}

function readNoteMarkdown(relPath: string): string | null {
  const full = noteFilePath(relPath);
  if (!full || !fs.existsSync(full)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(full, "utf8")) as { content?: unknown };
    if (!raw.content) return null;
    return blocksToText(raw.content as Parameters<typeof blocksToText>[0]);
  } catch {
    return null;
  }
}

function findTask(id: string, date?: string): { task: Task; date: string } | null {
  const dir = getTasksDir();
  if (!fs.existsSync(dir)) return null;
  const prefer = date ?? todayISO();
  const files = [
    `${prefer}.json`,
    ...fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== `${prefer}.json`),
  ];
  for (const file of files) {
    try {
      const tasks = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as Task[];
      const task = tasks.find((t) => t.id === id);
      if (task) return { task, date: file.replace(/\.json$/, "") };
    } catch {
      /* skip */
    }
  }
  return null;
}

function listAreaNotes(area: string): string[] {
  const root = path.join(getNotesDir(), area);
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, `${prefix}${entry.name}/`);
      } else if (entry.name.endsWith(".json")) {
        out.push(`${prefix}${entry.name.replace(/\.json$/, "")}`);
      }
    }
  };
  walk(root, `${area}/`);
  return out;
}

function refsFromNote(notePath: string): EntityRef[] {
  const md = readNoteMarkdown(notePath);
  if (!md) return [];
  return parseEntityLinksFromMarkdown(md).map((ref) => ({
    ...ref,
    href: defaultHrefForRef(ref) ?? ref.href,
  }));
}

/**
 * Resolve links for a given entity. Cheap path: check stable note path first,
 * then scan area notes that mention the entity id (bounded).
 */
export function resolveEntityLinks(kind: EntityKind, id: string, opts?: {
  date?: string;
  label?: string;
  href?: string;
  meetingTitle?: string;
  prRepo?: string;
  prNumber?: number;
}): EntityLinksResult {
  const entity: EntityRef = {
    kind,
    id,
    label: opts?.label || id,
    href: opts?.href || defaultHrefForRef({ kind, id, label: opts?.label || id }),
  };

  const notes: EntityRef[] = [];
  const related: EntityRef[] = [];

  const pushNote = (p: string, label: string) => {
    if (!noteExists(p)) return;
    notes.push({ kind: "note", id: p, label, href: noteHref(p) });
    related.push(...refsFromNote(p));
  };

  let suppressJiraKey: string | undefined;

  if (kind === "task") {
    const found = findTask(id, opts?.date);
    const date = found?.date ?? opts?.date ?? todayISO();
    const text = found?.task.text ?? opts?.label ?? id;
    suppressJiraKey = found?.task.jiraKey;
    // Companion note chip sits under the task title — don't re-echo the title.
    pushNote(taskNotePath({ id, text, date }), "Note");
    if (found?.task.links?.length) related.push(...found.task.links);
    // Free-form #tags typed in the task text are links too — they show as
    // chips and hop to a filtered work view.
    related.push(...tagRefs(text));
    // Do not auto-emit the task's own jiraKey as a related chip: the task row
    // already has JiraKeyChip (copy) + open-in-Jira. Explicit jira links in
    // task.links (a different key) still flow through above. Same-key refs
    // scraped from the companion note are stripped below.
  } else if (kind === "calendar" || kind === "meeting") {
    const title = opts?.meetingTitle || opts?.label || id;
    const start = opts?.date ? `${opts.date}T00:00:00` : `${todayISO()}T00:00:00`;
    pushNote(
      meetingNotePath({ title, start, end: start }),
      title.slice(0, 48) || "Meeting note",
    );
    // Also scan meetings/ for notes that mention this calendar id
    for (const p of listAreaNotes("meetings")) {
      const refs = refsFromNote(p);
      if (refs.some((r) => r.kind === "calendar" && (r.id === id || r.href === id))) {
        notes.push({ kind: "note", id: p, label: p.split("/").pop() || p, href: noteHref(p) });
        related.push(...refs);
      }
    }
  } else if (kind === "pr") {
    const repo = opts?.prRepo;
    const number = opts?.prNumber;
    if (repo && number != null) {
      pushNote(prNotePath({ repo, number }), `${repo}#${number}`);
    } else {
      // id form owner/repo#n
      const m = id.match(/^([^/#]+\/[^/#]+)#(\d+)$/);
      if (m) pushNote(prNotePath({ repo: m[1], number: Number(m[2]) }), id);
    }
  } else if (kind === "note") {
    notes.push({ kind: "note", id, label: opts?.label || id, href: noteHref(id) });
    related.push(...refsFromNote(id));
  }

  // Deduplicate notes/related excluding the queried entity itself
  const selfKey = entityKey(entity);
  const suppress = suppressJiraKey?.toUpperCase();
  return {
    entity,
    notes: mergeEntityRefs(notes),
    related: mergeEntityRefs(related).filter((r) => {
      if (entityKey(r) === selfKey) return false;
      if (suppress && r.kind === "jira" && r.id.toUpperCase() === suppress) return false;
      return true;
    }),
  };
}
