import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { findTask, invalidateTaskCache, withTaskLock } from "../../domains/tasks/store";
import { NotesStorage } from "../../domains/storage/notes";
import { getNotesDir } from "../content/dirs";
import { readOrchestration, orchestrationsDir } from "../storyboard/orchestration-store";
import { assertSafePath } from "./filesystem";
import { isTaskOpen, isTaskOwnershipBlocked } from "../../../../../packages/shared/tasks/types.ts";
import { resolveStoredTaskNotes } from "../../../../../packages/shared/task-note/resolve.ts";
import { normalizeTaskNotePath, updateTaskNote } from "../../../../../packages/shared/task-note/update.ts";
import { buildTaskNoteMarkdown } from "../../../../../packages/shared/task-note/index.ts";
import { textToBlocks } from "../../../../../packages/shared/markdown-convert/index.ts";
import { createFileContentStorage } from "../../../../../packages/shared/storage/file-content.ts";
import { jsonVaultCodec } from "../../../../../packages/shared/vault/vault-codec.ts";
import type { ServiceWorkflowRequest } from "../../../../../packages/shared/plugin-runtime";

/** Bind a reviewed plan to both the run and the full plan section. */
export function servicePlanFingerprint(runId: string, markdown: string): string {
  const plan = markdown.match(/^##\s+Plan\b[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im)?.[1]?.trim() ?? "";
  return createHash("sha256").update(JSON.stringify([runId, plan])).digest("hex");
}

/** Read a task's current thread state or append a note while it remains owned. */
export async function serviceWorkflowOperation(request: ServiceWorkflowRequest, directory: string, lockDirectory: string, current: () => boolean): Promise<unknown> {
  return withTaskLock(lockDirectory, async () => {
    if (!current()) throw new Error("Service authorisation or active task profile changed");
    const items = path.join(directory, "items");
    const readTask = () => {
      assertSafePath(directory, path.join(items, request.taskId + ".json"));
      if (fs.existsSync(items)) for (const name of fs.readdirSync(items)) {
        if (name.endsWith(".json") && !name.endsWith(".local.json")) assertSafePath(directory, path.join(items, name));
      }
      invalidateTaskCache(directory);
      return findTask(directory, request.taskId);
    };
    const task = readTask();
    if (!task || task.id !== request.taskId || task.createdAt !== request.createdAt || !isTaskOpen(task) || isTaskOwnershipBlocked(task)) throw new Error("Task is no longer available");

    const configured = getNotesDir();
    const root = fs.existsSync(configured) ? fs.realpathSync(configured) : path.resolve(configured);
    if (request.operation === "workflow-state") {
      assertSafePath(root, path.join(orchestrationsDir(root), task.id + ".json"));
      const record = readOrchestration(task.id, root);
      if (!current()) throw new Error("Service authorisation or active task profile changed");
      if (!record || record.terminal) return { kind: "idle" };
      const auto = record.auto;
      if (record.status === "needs-you" && auto?.phase === "plan" && auto.waiting?.kind === "plan-approval") {
        const run = auto.runs.filter((entry) => entry.phase === "plan" && entry.attempt === auto.attempt).at(-1);
        if (run) return { kind: "plan-ready", planRunId: run.runId };
      }
      return { kind: record.status === "starting" || record.status === "running" ? "running" : "idle" };
    }

    const safeNote = (candidate: string) => {
      const notePath = normalizeTaskNotePath(candidate);
      assertSafePath(root, path.join(root, notePath + ".json"));
      return notePath;
    };
    const resolveNote = () => resolveStoredTaskNotes(task, task.startDate, {
      readTask: (_date, id) => findTask(directory, id) ?? undefined,
      noteExists: (candidate) => fs.existsSync(path.join(root, safeNote(candidate) + ".json")),
    });
    const notePath = safeNote(resolveNote().notePath);
    const storage = new NotesStorage(root);
    const existing = storage.read(notePath);
    let updated: unknown;
    updateTaskNote({ read: () => existing, write: (_path, blocks) => { updated = blocks; } }, notePath,
      { op: "append_log", message: request.line }, {
        notesRoot: root,
        scaffold: () => textToBlocks(buildTaskNoteMarkdown({ id: task.id, text: task.text, date: task.startDate, jiraKey: task.jiraKey, notePath, related: task.links })),
      });
    if (updated !== undefined) {
      const writer = createFileContentStorage(root, { beforeWrite: () => {
        if (!current()) throw new Error("Service authorisation or active task profile changed");
        safeNote(notePath);
        if (JSON.stringify(readTask()) !== JSON.stringify(task) || safeNote(resolveNote().notePath) !== notePath) throw new Error("The task changed");
      } });
      await writer.write(notePath + ".json", jsonVaultCodec.serialize(updated), existing?.revision ?? null);
    }
    return null;
  });
}
