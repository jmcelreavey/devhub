/**
 * Read–modify–write of a task note for one section operation. The dashboard route
 * (`POST /api/tasks/note/sections`) and the MCP tool (`task_note_update`) both call
 * this, so validation, legacy migration, media import and the "only write when
 * something changed" rule exist once.
 */

import path from "node:path";
import { importLocalAsset } from "../notes-assets/server.ts";
import {
  TaskNoteOpError,
  applyTaskNoteOp,
  isTaskNotePath,
  migrateLegacyTaskNote,
  parseTaskNoteOp,
  readTaskNote,
  type NoteBlock,
  type TaskNoteView,
} from "./sections.ts";

export class TaskNoteNotFoundError extends TaskNoteOpError {}

/** The slice of a vault store this needs; `VaultStorage` and the MCP `NotesStorage` both fit. */
export interface TaskNoteStore {
  read(notePath: string): { content: unknown; modified: number } | null;
  write(notePath: string, content: unknown): unknown;
}

export interface UpdateTaskNoteOptions {
  /** Notes vault root; needed only to copy a `localFile` screenshot/video into the vault. */
  notesRoot: string;
  now?: Date;
  /** Blocks for a note that does not exist yet (the task's scaffold), or null to refuse. */
  scaffold?: () => unknown[] | null;
}

export interface UpdateTaskNoteResult {
  notePath: string;
  /** The note on disk now differs from before (the operation or the lazy migration wrote it). */
  changed: boolean;
  /** An old-shape header was folded into the metadata block as part of this write. */
  migrated: boolean;
  created: boolean;
  message: string;
  view: TaskNoteView;
}

export function normalizeTaskNotePath(raw: string): string {
  const notePath = raw.trim().replace(/^\/+/, "").replace(/\.json$/, "");
  if (!isTaskNotePath(notePath) || notePath.includes("..")) {
    throw new TaskNoteOpError("notePath must be a task note, e.g. task-notes/2026-10-07-<task id>");
  }
  return notePath;
}

export function updateTaskNote(
  store: TaskNoteStore,
  rawNotePath: string,
  input: unknown,
  options: UpdateTaskNoteOptions,
): UpdateTaskNoteResult {
  const notePath = normalizeTaskNotePath(rawNotePath);
  let fields = input;
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (raw.op === "add_media" && typeof raw.localFile === "string" && raw.localFile) {
    try {
      const slug = path.posix.basename(notePath);
      const imported = importLocalAsset(options.notesRoot, `task-notes/assets/${slug}`, raw.localFile);
      const { localFile: _localFile, ...rest } = raw;
      fields = { ...rest, assetPath: imported.path, url: undefined };
    } catch (error) {
      throw new TaskNoteOpError(error instanceof Error ? error.message : "Could not import localFile");
    }
  }

  const readOnly = raw.op === "read";
  const parsed = readOnly ? null : parseTaskNoteOp(fields);
  if (parsed && !parsed.ok) throw new TaskNoteOpError(parsed.error);

  const existing = store.read(notePath);
  let created = false;
  let original: unknown[];
  if (existing) {
    if (!Array.isArray(existing.content)) throw new TaskNoteOpError(`${notePath} is not a BlockNote note`);
    original = existing.content;
  } else {
    const scaffold = readOnly ? null : options.scaffold?.();
    if (!scaffold) {
      throw new TaskNoteNotFoundError(`No note at ${notePath}. Create it first (notes_create_task) or pass the task id.`);
    }
    original = scaffold;
    created = true;
  }

  const migration = migrateLegacyTaskNote(original);
  if (!parsed) {
    // `read` never writes, so opening a legacy note through it leaves the file alone.
    return {
      notePath,
      changed: false,
      migrated: false,
      created: false,
      message: "Read",
      view: readTaskNote(migration.blocks),
    };
  }
  const result = applyTaskNoteOp(migration.blocks, parsed.op, { now: options.now });
  const changed = created || result.changed || migration.changed;
  if (changed) store.write(notePath, result.blocks);
  return {
    notePath,
    changed,
    migrated: migration.changed,
    created,
    message: result.message,
    view: readTaskNote(result.blocks as NoteBlock[]),
  };
}

/** Compact, id-bearing text for agents: what the note holds now, and what is still open. */
export function describeTaskNote(result: UpdateTaskNoteResult): string {
  const { view } = result;
  const lines = [
    `${result.message}${result.changed ? "" : " (no change)"}${result.created ? " [note created]" : ""}${result.migrated ? " [old header folded into metadata]" : ""}: ${result.notePath}`,
    `Status: ${view.meta?.status ?? "unset"} | tags: ${(view.meta?.tags ?? []).join(", ") || "none"} | models: ${(view.meta?.models ?? []).join(", ") || "none"} | links: ${view.meta?.links?.length ?? 0}`,
    `Summary: ${view.summary.length ? "set" : "empty"} | decisions: ${view.decisions.length} | media: ${view.media.length} | bugs: ${view.bugs.length} (${view.bugs.filter((b) => b.status === "open").length} open) | waypoints: ${view.waypoints.length} | log: ${view.log.length}`,
  ];
  const open = view.questions.filter((q) => !q.resolved);
  if (open.length) lines.push("Open questions:", ...open.map((q) => `- [${q.id}] ${q.text}`));
  const bugs = view.bugs.filter((b) => b.status === "open");
  if (bugs.length) lines.push("Open bugs:", ...bugs.map((b) => `- [${b.id}] ${b.severity ? `${b.severity}: ` : ""}${b.title}`));
  return lines.join("\n");
}
